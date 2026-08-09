import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Eye, EyeOff, Users } from "lucide-react";
import { PageContainer } from "../../components/PageContainer.js";
import { PageHeader } from "../../components/PageHeader.js";
import { EmptyState } from "../../components/EmptyState.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import {
  DataGrid,
  type DataGridColumn,
} from "../../components/ui/data-grid.js";
import { RowActions } from "../../components/ui/row-actions.js";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../components/ui/sheet.js";
import { Spinner } from "../../components/ui/spinner.js";
import {
  api,
  type InstanceOrganizationDetail,
  type InstanceOrganizationSummary,
} from "../../lib/api.js";
import { qk } from "../../lib/query-client.js";
import { useApiMutation } from "../../lib/use-api.js";
import { useInstanceAdmin } from "../../lib/use-instance-admin.js";

/**
 * Organizations — every org on this instance.
 *
 * Deliberately the *infrastructure* view: who exists, who is in them, what mail
 * they hold and how much they send. Not their mail. An instance administrator
 * runs the server, which is a different thing from being entitled to read
 * everyone's inbox — so there is no route from here into an org's messages,
 * contacts or campaigns, and the API has none either.
 */
export function InstanceOrganizations() {
  const { isInstanceAdmin, isPending } = useInstanceAdmin();
  const [openOrgId, setOpenOrgId] = useState<string | null>(null);
  const [showMuted, setShowMuted] = useState(false);

  const enabled = isInstanceAdmin === true;

  const organizationsQuery = useQuery<InstanceOrganizationSummary[]>({
    queryKey: qk.instanceOrganizations(),
    queryFn: () => api.listInstanceOrganizations(),
    enabled,
  });

  const mutesQuery = useQuery({
    queryKey: qk.instanceMutes(),
    queryFn: () => api.listInstanceMutes(),
    enabled,
  });

  const detailQuery = useQuery<InstanceOrganizationDetail>({
    queryKey: qk.instanceOrganization(openOrgId ?? ""),
    queryFn: () => api.getInstanceOrganization(openOrgId as string),
    enabled: enabled && openOrgId !== null,
  });

  const toggleMute = useApiMutation(
    async (organization: InstanceOrganizationSummary) => {
      if (!organization.muted) {
        await api.addInstanceMute({ scope: "ORG", target: organization.id });
        return;
      }
      const existing = (mutesQuery.data ?? []).find(
        (mute) => mute.scope === "ORG" && mute.target === organization.id
      );
      if (existing) {
        await api.removeInstanceMute(existing.id);
      }
    },
    {
      successMessage: (_result, organization) =>
        organization.muted
          ? `${organization.name} is back in your lists.`
          : `${organization.name} hidden from your lists. Their access is unchanged.`,
      errorMessage: "Couldn't update your view.",
      invalidates: [qk.instanceOrganizations(), qk.instanceMutes()],
    }
  );

  const all = useMemo(
    () => organizationsQuery.data ?? [],
    [organizationsQuery.data]
  );
  const mutedCount = all.filter((organization) => organization.muted).length;
  // Muted rows are filtered here rather than server-side so the count is always
  // available: a list that silently dropped rows would read as missing data.
  const rows = showMuted
    ? all
    : all.filter((organization) => !organization.muted);

  const columns = useMemo<DataGridColumn<InstanceOrganizationSummary>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Organization",
        meta: { title: "Organization" },
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate font-medium">{row.original.name}</span>
            {row.original.muted ? (
              <Badge variant="outline">Muted</Badge>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "memberCount",
        header: "People",
        meta: { title: "People" },
        cell: ({ row }) => row.original.memberCount,
      },
      {
        accessorKey: "domainCount",
        header: "Domains",
        meta: { title: "Domains" },
        cell: ({ row }) =>
          row.original.domainCount === 0 ? (
            <span className="text-muted-foreground">None assigned</span>
          ) : (
            row.original.domainCount
          ),
      },
      {
        accessorKey: "sendingAccountCount",
        header: "Sending accounts",
        meta: { title: "Sending accounts" },
        cell: ({ row }) => row.original.sendingAccountCount,
      },
      {
        id: "actions",
        header: "",
        meta: { pinned: true, align: "right" },
        cell: ({ row }) => (
          <RowActions
            rowLabel={row.original.name}
            actions={[
              {
                label: "View details",
                icon: Users,
                primary: true,
                onSelect: () => setOpenOrgId(row.original.id),
              },
              {
                label: row.original.muted
                  ? "Show in my lists"
                  : "Hide from my lists",
                icon: row.original.muted ? Eye : EyeOff,
                onSelect: () => toggleMute.mutate(row.original),
              },
            ]}
          />
        ),
      },
    ],
    [toggleMute]
  );

  const header = (
    <PageHeader
      title="Organizations"
      description="Every organization on this instance."
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
            icon={Building2}
            title="Instance administrators only"
            description="This is the server-wide view of every organization on the instance."
          />
        </PageContainer>
      </>
    );
  }

  const detail = detailQuery.data;

  return (
    <>
      {header}
      <PageContainer>
        <DataGrid
          label="Organizations"
          data={rows}
          columns={columns}
          loading={organizationsQuery.isPending}
          getRowId={(row) => row.id}
          toolbar={
            mutedCount > 0 ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setShowMuted((current) => !current)}
              >
                {showMuted ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
                {showMuted
                  ? `Hide ${mutedCount} muted`
                  : `Show ${mutedCount} muted`}
              </Button>
            ) : null
          }
          empty={
            <EmptyState
              icon={Building2}
              title="No organizations yet"
              description="Nobody has created an organization on this instance."
            />
          }
          renderMobileRow={(row) => (
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium">{row.name}</span>
                {row.muted ? <Badge variant="outline">Muted</Badge> : null}
              </div>
              <div className="text-meta text-muted-foreground">
                {row.memberCount} {row.memberCount === 1 ? "person" : "people"} ·{" "}
                {row.domainCount} domain{row.domainCount === 1 ? "" : "s"} ·{" "}
                {row.sendingAccountCount} sending account
                {row.sendingAccountCount === 1 ? "" : "s"}
              </div>
            </div>
          )}
        />

        <Sheet
          open={openOrgId !== null}
          onOpenChange={(open) => setOpenOrgId(open ? openOrgId : null)}
        >
          <SheetContent className="sm:max-w-xl">
            <SheetHeader>
              <SheetTitle>{detail?.name ?? "Organization"}</SheetTitle>
              <SheetDescription>
                Members, mail domains, sending accounts and send volume. Message
                content is not shown here — or reachable from here.
              </SheetDescription>
            </SheetHeader>

            <SheetBody className="space-y-5">
              {detailQuery.isPending ? (
                <div className="flex items-center gap-2 text-body text-muted-foreground">
                  <Spinner />
                  Loading…
                </div>
              ) : !detail ? (
                <p className="text-body text-muted-foreground">
                  Couldn&apos;t load this organization.
                </p>
              ) : (
                <>
                  <section>
                    <h3 className="text-ui font-medium text-text">
                      Last 30 days
                    </h3>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {(
                        [
                          ["Sent", detail.stats.sent],
                          ["Failed", detail.stats.failed],
                          ["Bounced", detail.stats.bounced],
                          ["Suppressed", detail.stats.suppressed],
                        ] as const
                      ).map(([label, value]) => (
                        <Card key={label}>
                          <CardContent className="p-3">
                            <div className="text-eyebrow uppercase tracking-eyebrow text-text-tertiary">
                              {label}
                            </div>
                            <div className="text-ui font-medium text-text">
                              {value.toLocaleString()}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </section>

                  <section>
                    <h3 className="text-ui font-medium text-text">
                      People ({detail.members.length})
                    </h3>
                    <ul className="mt-2 space-y-1">
                      {detail.members.map((member) => (
                        <li
                          key={member.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-border px-3 py-2"
                        >
                          <span className="min-w-0 truncate text-body">
                            {member.name ?? member.email}
                          </span>
                          <Badge variant="secondary">{member.role}</Badge>
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section>
                    <h3 className="text-ui font-medium text-text">
                      Mail domains ({detail.domains.length})
                    </h3>
                    {detail.domains.length === 0 ? (
                      <p className="mt-2 text-meta text-muted-foreground">
                        None assigned, so this organization cannot provision
                        mailboxes. Assign one under Domains.
                      </p>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {detail.domains.map((domain) => (
                          <Badge key={domain} variant="secondary">
                            {domain}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </section>

                  <section>
                    <h3 className="text-ui font-medium text-text">
                      Sending accounts ({detail.sendingAccounts.length})
                    </h3>
                    <ul className="mt-2 space-y-1">
                      {detail.sendingAccounts.map((account) => (
                        <li
                          key={account.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-border px-3 py-2"
                        >
                          <span className="min-w-0 truncate text-body">
                            {account.fromEmail}
                          </span>
                          {account.isDefault ? (
                            <Badge variant="secondary">Default</Badge>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                </>
              )}
            </SheetBody>
          </SheetContent>
        </Sheet>
      </PageContainer>
    </>
  );
}
