import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { PageContainer } from "../../components/PageContainer.js";
import { PageHeader } from "../../components/PageHeader.js";
import { EmptyState } from "../../components/EmptyState.js";
import { Badge } from "../../components/ui/badge.js";
import {
  DataGrid,
  type DataGridColumn,
} from "../../components/ui/data-grid.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import { Spinner } from "../../components/ui/spinner.js";
import { Hint } from "../../components/ui/tooltip.js";
import { api, type InstanceMailboxSummary } from "../../lib/api.js";
import { qk } from "../../lib/query-client.js";
import { useInstanceAdmin } from "../../lib/use-instance-admin.js";

const ALL_DOMAINS = "__all__";

function formatBytes(bytes: number) {
  if (bytes <= 0) return "Unlimited";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

/**
 * Mailboxes — every mailbox on the mail server, instance-wide.
 *
 * Read-only on purpose. The per-mailbox actions (reset password, disable,
 * delete) stay on the org-scoped Mailboxes page, where the person taking them
 * is the one who owns the consequences. This view answers "what exists on my
 * server and who holds it", which is the question an administrator has and the
 * org-scoped page structurally cannot answer.
 *
 * Server inventory is the source, not QQueue's sending accounts: a mailbox made
 * in the Mailcow UI receives real mail whether or not QQueue knows about it, so
 * listing only what QQueue created would under-report the server.
 */
export function InstanceMailboxes() {
  const { isInstanceAdmin, isPending } = useInstanceAdmin();
  const [domainFilter, setDomainFilter] = useState(ALL_DOMAINS);

  const mailboxesQuery = useQuery<InstanceMailboxSummary[]>({
    queryKey: qk.instanceMailboxes(),
    queryFn: () => api.listInstanceMailboxes(),
    enabled: isInstanceAdmin === true,
  });

  const mailboxes = useMemo(
    () => mailboxesQuery.data ?? [],
    [mailboxesQuery.data]
  );
  const domains = useMemo(
    () => [...new Set(mailboxes.map((mailbox) => mailbox.domain))].sort(),
    [mailboxes]
  );
  const rows =
    domainFilter === ALL_DOMAINS
      ? mailboxes
      : mailboxes.filter((mailbox) => mailbox.domain === domainFilter);

  const columns = useMemo<DataGridColumn<InstanceMailboxSummary>[]>(
    () => [
      {
        accessorKey: "email",
        header: "Mailbox",
        meta: { title: "Mailbox" },
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium">{row.original.email}</span>
              {!row.original.active ? (
                <Badge variant="destructive">Disabled</Badge>
              ) : null}
              {!row.original.connected ? (
                <Hint label="Exists on the mail server but QQueue holds no sending account for it. It still receives mail.">
                  <Badge variant="outline" className="cursor-help">
                    Server only
                  </Badge>
                </Hint>
              ) : null}
            </div>
            {row.original.name ? (
              <div className="truncate text-meta text-muted-foreground">
                {row.original.name}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: "organizations",
        // Sorts and filters on the joined names, since the value is a list.
        accessorFn: (row) =>
          row.organizations.map((organization) => organization.name).join(", "),
        header: "Organizations",
        meta: { title: "Organizations" },
        cell: ({ row }) =>
          row.original.organizations.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {row.original.organizations.map((organization) => (
                <Badge key={organization.id} variant="secondary">
                  {organization.name}
                </Badge>
              ))}
            </div>
          ) : (
            <Hint label="Its domain is assigned to no organization, so no org can manage this mailbox from QQueue.">
              <span className="cursor-help text-muted-foreground">
                Unassigned
              </span>
            </Hint>
          ),
      },
      {
        accessorKey: "usedBytes",
        header: "Storage",
        meta: { title: "Storage" },
        cell: ({ row }) =>
          row.original.quotaBytes
            ? `${formatBytes(row.original.usedBytes)} of ${formatBytes(row.original.quotaBytes)}`
            : formatBytes(row.original.usedBytes),
      },
    ],
    []
  );

  const header = (
    <PageHeader
      title="Mailboxes"
      description="Every mailbox on the mail server, and the organization that holds it."
      breadcrumb={{ label: "Settings", to: "/settings" }}
    />
  );

  if (isPending) {
    return (
      <>
        {header}
        <PageContainer>
          <div className="flex items-center gap-2 text-body text-muted-foreground">
            <Spinner />
            Checking access…
          </div>
        </PageContainer>
      </>
    );
  }

  if (!isInstanceAdmin) {
    return (
      <>
        {header}
        <PageContainer>
          <EmptyState
            icon={Mail}
            title="Instance administrators only"
            description="This is the server-wide mailbox inventory. Your own organization's mailboxes are under Settings → Mailboxes."
          />
        </PageContainer>
      </>
    );
  }

  return (
    <>
      {header}
      <PageContainer>
        <DataGrid
          label="Mailboxes"
          data={rows}
          columns={columns}
          loading={mailboxesQuery.isPending}
          getRowId={(row) => row.email}
          toolbar={
            domains.length > 1 ? (
              <Select value={domainFilter} onValueChange={setDomainFilter}>
                <SelectTrigger
                  aria-label="Filter by domain"
                  className="w-full sm:w-56"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_DOMAINS}>
                    All domains ({mailboxes.length})
                  </SelectItem>
                  {domains.map((domain) => (
                    <SelectItem key={domain} value={domain}>
                      {domain} (
                      {mailboxes.filter((m) => m.domain === domain).length})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null
          }
          empty={
            <EmptyState
              icon={Mail}
              title="No mailboxes on the server"
              description="Nothing has been provisioned yet on any domain."
            />
          }
          renderMobileRow={(row) => (
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium">{row.email}</span>
                {!row.active ? (
                  <Badge variant="destructive">Disabled</Badge>
                ) : null}
              </div>
              <div className="text-meta text-muted-foreground">
                {row.organizations.length > 0
                  ? row.organizations
                      .map((organization) => organization.name)
                      .join(", ")
                  : "Unassigned"}{" "}
                ·{" "}
                {row.quotaBytes
                  ? `${formatBytes(row.usedBytes)} of ${formatBytes(row.quotaBytes)}`
                  : formatBytes(row.usedBytes)}
              </div>
            </div>
          )}
        />
      </PageContainer>
    </>
  );
}
