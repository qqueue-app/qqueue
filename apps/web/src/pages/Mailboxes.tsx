import { useEffect, useMemo, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Copy,
  Globe,
  KeyRound,
  Link2,
  Mail,
  Plus,
  Power,
  PowerOff,
  Server,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { PageContainer } from "../components/PageContainer.js";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { PermissionMatrix } from "../components/PermissionMatrix.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import {
  api,
  type MailDomainGrant,
  type MailboxProvisionResult,
  type MailboxSummary,
  type OrganizationMember,
  type SmtpConnectionGrant,
} from "../lib/api.js";
import { qk } from "../lib/query-client.js";
import { useApiMutation, useOrgQuery } from "../lib/use-api.js";
import { useSession } from "../lib/session-context.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent } from "../components/ui/card.js";
import { DataGrid } from "../components/ui/data-grid.js";
import { IconButton } from "../components/ui/icon-button.js";
import { RowActions } from "../components/ui/row-actions.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import { Spinner } from "../components/ui/spinner.js";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs.js";
import { Hint } from "../components/ui/tooltip.js";

const NO_ASSIGNEE = "__none__";
const ALL_DOMAINS = "__all__";

function memberName(member: OrganizationMember) {
  return member.user.name ?? member.user.email;
}

function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

/** Mail-server storage. A quota of 0 is Mailcow's "no limit". */
function formatUsage(mailbox: MailboxSummary) {
  if (mailbox.usedBytes === null) return "—";
  const used = formatBytes(mailbox.usedBytes);
  return mailbox.quotaBytes
    ? `${used} of ${formatBytes(mailbox.quotaBytes)}`
    : used;
}

/** A password shown exactly once, from either creating or resetting a mailbox. */
interface RevealedPassword {
  kind: "created" | "reset";
  email: string;
  mailboxPassword: string;
  /** Only meaningful after creation; a reset changes nothing about sending. */
  verified: boolean | null;
}

type PendingConfirm =
  | { kind: "reset"; mailbox: MailboxSummary }
  | { kind: "disable"; mailbox: MailboxSummary }
  | { kind: "delete"; mailbox: MailboxSummary };

/**
 * Mailboxes — where an owner or admin creates team mailboxes and decides who
 * may send as each one.
 *
 * Three questions, three tabs: what mailboxes exist, who can send as them, and
 * (owners only) which domains each admin may create mailboxes on. The access
 * question is answered by a people × mailboxes grid rather than a per-mailbox
 * grant form, so the whole picture is visible at once.
 *
 * The mailbox list is the mail server's inventory merged with QQueue's sending
 * accounts, not just the latter — a mailbox someone made in the Mailcow UI
 * receives real mail, so hiding it would make this page lie about the domain.
 */
export function Mailboxes() {
  const { currentOrganizationId: organizationId, currentOrganization } =
    useSession();
  const queryClient = useQueryClient();
  const canManage =
    currentOrganization?.role === "OWNER" ||
    currentOrganization?.role === "ADMIN";
  const isOwner = currentOrganization?.role === "OWNER";

  const [createOpen, setCreateOpen] = useState(false);
  const [domainFilter, setDomainFilter] = useState(ALL_DOMAINS);
  const [revealed, setRevealed] = useState<RevealedPassword | null>(null);
  const [adopting, setAdopting] = useState<MailboxSummary | null>(null);
  const [confirming, setConfirming] = useState<PendingConfirm | null>(null);
  const [pendingCells, setPendingCells] = useState<Set<string>>(new Set());

  const statusQuery = useOrgQuery(
    canManage ? organizationId : null,
    qk.mailcowStatus(organizationId ?? ""),
    (id) => api.getMailcowStatus(id)
  );
  // The merged list backs the Mailboxes tab. The raw connection list is still
  // needed on its own for the "Who can send" matrix, whose columns are sending
  // accounts — a mailbox with no account in QQueue cannot be sent as at all.
  const mailboxesQuery = useOrgQuery(
    canManage ? organizationId : null,
    qk.mailboxes(organizationId ?? ""),
    (id) => api.listMailboxes(id)
  );
  const connectionsQuery = useOrgQuery(
    canManage ? organizationId : null,
    qk.smtpConnections(organizationId ?? ""),
    (id) => api.listSMTPConnections(id)
  );
  const membersQuery = useOrgQuery(
    canManage ? organizationId : null,
    qk.members(organizationId ?? ""),
    (id) => api.listOrganizationMembers(id)
  );
  const domainGrantsQuery = useOrgQuery(
    isOwner ? organizationId : null,
    qk.mailDomainGrants(organizationId ?? ""),
    (id) => api.listMailDomainGrants(id)
  );

  const mailboxes = useMemo(
    () => mailboxesQuery.data ?? [],
    [mailboxesQuery.data]
  );
  const connections = useMemo(
    () => connectionsQuery.data ?? [],
    [connectionsQuery.data]
  );
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const status = statusQuery.data;

  // One grants query per connection rather than a combined endpoint: each has
  // its own cache entry, so toggling access on one mailbox refetches only that
  // mailbox instead of the whole matrix.
  //
  // `combine` is essential, not cosmetic: the raw `useQueries` result is a new
  // array on every render, which would make every memo derived from it — and
  // therefore the grid's column definitions — change identity each pass and
  // re-render forever. The combined value is memoised on the query results.
  const grantLists = useQueries({
    queries: connections.map((connection) => ({
      queryKey: qk.connectionGrants(connection.id),
      queryFn: () => api.listConnectionGrants(connection.id),
      enabled: canManage,
    })),
    combine: (results) => results.map((result) => result.data ?? []),
  });

  const grantsByConnection = useMemo(() => {
    const map = new Map<string, SmtpConnectionGrant[]>();
    connections.forEach((connection, index) => {
      map.set(connection.id, grantLists[index] ?? []);
    });
    return map;
  }, [connections, grantLists]);

  const grantedUserIds = useMemo(() => {
    const set = new Set<string>();
    grantsByConnection.forEach((grants, connectionId) => {
      grants.forEach((grant) => set.add(`${grant.userId}:${connectionId}`));
    });
    return set;
  }, [grantsByConnection]);

  const mailboxCountByDomain = useMemo(() => {
    const counts = new Map<string, number>();
    for (const mailbox of mailboxes) {
      if (mailbox.domain) {
        counts.set(mailbox.domain, (counts.get(mailbox.domain) ?? 0) + 1);
      }
    }
    return counts;
  }, [mailboxes]);

  // Mail server domains are the ones a *new* mailbox can be created on, but a
  // sending account added by hand may live on a domain the mail server never
  // reported. List both, so picking a domain never hides an existing mailbox.
  const domains = useMemo(() => {
    const all = new Set<string>(status?.domains ?? []);
    for (const domain of mailboxCountByDomain.keys()) all.add(domain);
    return [...all].sort((a, b) => a.localeCompare(b));
  }, [mailboxCountByDomain, status?.domains]);

  const visibleMailboxes = useMemo(
    () =>
      domainFilter === ALL_DOMAINS
        ? mailboxes
        : mailboxes.filter((mailbox) => mailbox.domain === domainFilter),
    [mailboxes, domainFilter]
  );

  // A domain can go away under the filter — an owner revokes an admin's domain
  // grant, or the last hand-added account on it is deleted. Fall back to all
  // domains rather than leaving the page stuck on an empty, unexplained list.
  useEffect(() => {
    if (
      domainFilter !== ALL_DOMAINS &&
      domains.length > 0 &&
      !domains.includes(domainFilter)
    ) {
      setDomainFilter(ALL_DOMAINS);
    }
  }, [domainFilter, domains]);

  const loading =
    statusQuery.isPending ||
    mailboxesQuery.isPending ||
    connectionsQuery.isPending ||
    membersQuery.isPending;

  async function toggleGrant(
    userId: string,
    connectionId: string,
    next: boolean
  ) {
    const key = `${userId}:${connectionId}`;
    setPendingCells((current) => new Set(current).add(key));
    try {
      if (next) {
        await api.addConnectionGrant(connectionId, userId);
      } else {
        await api.removeConnectionGrant(connectionId, userId);
      }
      await queryClient.invalidateQueries({
        queryKey: qk.connectionGrants(connectionId),
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't change access."
      );
    } finally {
      setPendingCells((current) => {
        const updated = new Set(current);
        updated.delete(key);
        return updated;
      });
    }
  }

  const addDomainGrant = useApiMutation(
    (input: { userId: string; domain: string }) =>
      api.addMailDomainGrant({
        organizationId: organizationId as string,
        ...input,
      }),
    {
      successMessage: "Domain access granted.",
      errorMessage: "Couldn't grant that domain.",
      invalidates: [qk.mailDomainGrants(organizationId ?? "")],
    }
  );

  const removeDomainGrant = useApiMutation(
    (grant: MailDomainGrant) =>
      api.removeMailDomainGrant(grant.id, organizationId as string),
    {
      successMessage: "Domain access removed.",
      errorMessage: "Couldn't remove that domain.",
      invalidates: [qk.mailDomainGrants(organizationId ?? "")],
    }
  );

  // Every mailbox mutation refetches the merged list; the ones that add or
  // remove a sending account refetch the connection list too, because the
  // "Who can send" matrix is built from it.
  const mailboxKeys = [qk.mailboxes(organizationId ?? "")];
  const mailboxAndConnectionKeys = [
    qk.mailboxes(organizationId ?? ""),
    qk.smtpConnections(organizationId ?? ""),
  ];

  const resetPassword = useApiMutation(
    (mailbox: MailboxSummary) =>
      api.resetMailboxPassword(mailbox.email, organizationId as string),
    {
      errorMessage: "Couldn't reset that password.",
      onSuccess: (result) => {
        setConfirming(null);
        setRevealed({
          kind: "reset",
          email: result.email,
          mailboxPassword: result.mailboxPassword,
          verified: null,
        });
      },
    }
  );

  const setMailboxActive = useApiMutation(
    ({ mailbox, active }: { mailbox: MailboxSummary; active: boolean }) =>
      api.setMailboxActive(mailbox.email, organizationId as string, active),
    {
      successMessage: (_result, { mailbox, active }) =>
        active
          ? `${mailbox.email} is receiving mail again.`
          : `${mailbox.email} has stopped receiving mail.`,
      errorMessage: "Couldn't change that mailbox.",
      invalidates: mailboxKeys,
      onSuccess: () => setConfirming(null),
    }
  );

  const deleteMailbox = useApiMutation(
    (mailbox: MailboxSummary) =>
      api.deleteMailbox(mailbox.email, organizationId as string),
    {
      successMessage: (result) =>
        result.inboxAccountDisabled
          ? `${result.email} is deleted. Mail already synced into QQueue is kept.`
          : `${result.email} is deleted.`,
      errorMessage: "Couldn't delete that mailbox.",
      invalidates: mailboxAndConnectionKeys,
      onSuccess: () => setConfirming(null),
    }
  );

  // TanStack keeps `mutate` stable across renders, unlike the mutation object
  // itself — naming it is what lets the column memo depend on it without
  // rebuilding every pass.
  const { mutate: mutateMailboxActive } = setMailboxActive;

  const mailboxColumns = useMemo<ColumnDef<MailboxSummary, unknown>[]>(
    () => [
      {
        accessorKey: "email",
        header: "Address",
        meta: { title: "Address" },
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{row.original.email}</span>
              {row.original.isDefault ? (
                <Hint label="New mail sends from this account unless another is chosen">
                  <Badge className="cursor-help">Default</Badge>
                </Hint>
              ) : null}
              {row.original.origin === "SERVER_ONLY" ? (
                <Hint label="This mailbox exists on your mail server but QQueue can't send from it yet. Connect it to change that.">
                  <Badge variant="secondary" className="cursor-help">
                    Not connected
                  </Badge>
                </Hint>
              ) : null}
              {row.original.active === false ? (
                <Hint label="Your mail server is refusing mail for this address">
                  <Badge variant="destructive" className="cursor-help">
                    Disabled
                  </Badge>
                </Hint>
              ) : null}
            </div>
            <div className="truncate text-meta text-muted-foreground md:hidden">
              {row.original.name}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "name",
        header: "Name",
        meta: { title: "Name", hideBelowMd: true },
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.name}</span>
        ),
      },
      {
        accessorKey: "domain",
        header: "Domain",
        meta: { title: "Domain", hideBelowLg: true },
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{String(getValue())}</span>
        ),
      },
      {
        id: "storage",
        header: "Storage",
        meta: { title: "Storage", hideBelowLg: true },
        // Sorts on raw bytes so the fullest mailbox is one click away; the
        // formatted string would sort "9 MB" after "10 GB".
        accessorFn: (row) => row.usedBytes ?? -1,
        cell: ({ row }) => (
          <span className="text-meta text-muted-foreground">
            {formatUsage(row.original)}
          </span>
        ),
      },
      {
        id: "server",
        accessorFn: (row) => (row.host ? `${row.host}:${row.port}` : ""),
        header: "Server",
        meta: { title: "Server", hideBelowLg: true },
        cell: ({ getValue }) => {
          const value = String(getValue());
          return (
            <span className="font-mono text-meta text-muted-foreground">
              {value || "—"}
            </span>
          );
        },
      },
      {
        id: "access",
        header: "Who can send",
        meta: { title: "Who can send", align: "center" },
        // Sorts by how many people hold a grant, so "nobody has access to this
        // mailbox" surfaces at one end of the sort. Mailboxes QQueue can't send
        // from at all sort below that, at -1.
        accessorFn: (row) =>
          row.smtpConnectionId
            ? (grantsByConnection.get(row.smtpConnectionId)?.length ?? 0)
            : -1,
        cell: ({ row }) => {
          const connectionId = row.original.smtpConnectionId;
          if (!connectionId) {
            return (
              <Hint label="QQueue has no credentials for this mailbox yet, so nobody can send as it">
                <span className="cursor-help text-body text-muted-foreground">
                  —
                </span>
              </Hint>
            );
          }
          const grants = grantsByConnection.get(connectionId) ?? [];
          const names = grants
            .map((grant) => grant.user?.name ?? grant.user?.email ?? "someone")
            .join(", ");
          return (
            <Hint
              label={
                grants.length === 0
                  ? "Only owners and admins, who can always send as any account"
                  : `Owners and admins, plus ${names}`
              }
            >
              <span className="inline-flex cursor-help items-center gap-field text-body text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                {grants.length === 0 ? "Admins only" : `+${grants.length}`}
              </span>
            </Hint>
          );
        },
      },
      {
        id: "actions",
        header: "",
        meta: { pinned: true, align: "right" },
        enableSorting: false,
        cell: ({ row }) => {
          const mailbox = row.original;
          // EXTERNAL rows have no mailbox on this mail server to administer —
          // they're hand-added sending accounts, or on a domain this admin
          // wasn't granted. They keep the account-level actions and nothing more.
          const onServer = mailbox.origin !== "EXTERNAL";
          const connectionId = mailbox.smtpConnectionId;

          return (
            <RowActions
              rowLabel={mailbox.email}
              actions={[
                {
                  label: "Connect to QQueue",
                  icon: Link2,
                  primary: true,
                  hidden: mailbox.origin !== "SERVER_ONLY",
                  onSelect: () => setAdopting(mailbox),
                },
                {
                  label: "Test connection",
                  icon: ShieldCheck,
                  hidden: !connectionId,
                  onSelect: async () => {
                    if (!connectionId) return;
                    const toastId = toast.loading("Testing connection…");
                    try {
                      await api.verifySMTPConnection(connectionId);
                      toast.success("Connection works.", { id: toastId });
                    } catch (error) {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "Connection failed.",
                        { id: toastId }
                      );
                    }
                  },
                },
                {
                  label: "Copy address",
                  icon: Copy,
                  onSelect: async () => {
                    await navigator.clipboard.writeText(mailbox.email);
                    toast.success("Address copied.");
                  },
                },
                {
                  label: "Reset password",
                  icon: KeyRound,
                  hidden: !onServer,
                  onSelect: () => setConfirming({ kind: "reset", mailbox }),
                },
                {
                  label: mailbox.active ? "Stop delivery" : "Resume delivery",
                  icon: mailbox.active ? PowerOff : Power,
                  hidden: !onServer,
                  onSelect: () => {
                    // Turning a mailbox back on restores the status quo, so it
                    // goes straight through; switching it off loses mail.
                    if (mailbox.active) {
                      setConfirming({ kind: "disable", mailbox });
                    } else {
                      mutateMailboxActive({ mailbox, active: true });
                    }
                  },
                },
                {
                  label: "Delete mailbox",
                  icon: Trash2,
                  destructive: true,
                  hidden: !onServer,
                  onSelect: () => setConfirming({ kind: "delete", mailbox }),
                },
              ]}
            />
          );
        },
      },
    ],
    [grantsByConnection, mutateMailboxActive]
  );

  if (!canManage) {
    return (
      <>
        <PageHeader
          title="Mailboxes"
          description="Create team mailboxes and choose who can send as them."
          breadcrumb={{ label: "Settings", to: "/settings" }}
        />
        <PageContainer>
          <Card>
            <EmptyState
              icon={Mail}
              title="Owners and admins only"
              description="Ask an owner or admin to create a mailbox for you, or to let you send as an existing one."
            />
          </Card>
        </PageContainer>
      </>
    );
  }

  const admins = members.filter((member) => member.role === "ADMIN");

  return (
    <>
      <PageHeader
        title="Mailboxes"
        description="Create team mailboxes on your mail server and choose who can send as each one."
        breadcrumb={{ label: "Settings", to: "/settings" }}
        actions={
          status?.configured && status.reachable ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              New mailbox
            </Button>
          ) : null
        }
      />

      <PageContainer>
        {!loading && !status?.configured ? (
          <Card>
            <EmptyState
              icon={Server}
              title="Your mail server isn't connected yet"
              description="Set MAILCOW_API_URL and MAILCOW_API_KEY in this instance's .env to create mailboxes from here. You can still add sending accounts by hand under Sending accounts."
            />
          </Card>
        ) : !loading && !status?.reachable ? (
          <Card className="border-destructive/40">
            <CardContent className="flex items-start gap-3 p-card">
              <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-destructive" />
              <div>
                <p className="font-medium">Your mail server isn't answering</p>
                <p className="mt-1 text-body text-muted-foreground">
                  QQueue is configured to talk to Mailcow but couldn't reach it
                  {status?.error ? `: ${status.error}` : "."} Existing mailboxes
                  still send; you just can't create new ones until it responds.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Tabs defaultValue="mailboxes" className="mt-4 first:mt-0">
          <TabsList>
            <TabsTrigger value="mailboxes">
              <Mail className="h-4 w-4" />
              Mailboxes
            </TabsTrigger>
            <TabsTrigger value="access">
              <Users className="h-4 w-4" />
              Who can send
            </TabsTrigger>
            {isOwner ? (
              <TabsTrigger value="domains">
                <Globe className="h-4 w-4" />
                Domain access
              </TabsTrigger>
            ) : null}
          </TabsList>

          <TabsContent value="mailboxes">
            <DataGrid
              label="Mailboxes"
              data={visibleMailboxes}
              columns={mailboxColumns}
              getRowId={(row) => row.smtpConnectionId ?? row.email}
              loading={loading}
              searchPlaceholder="Search mailboxes…"
              toolbar={
                domains.length > 0 ? (
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
                      {domains.map((candidate) => (
                        <SelectItem key={candidate} value={candidate}>
                          {candidate} ({mailboxCountByDomain.get(candidate) ?? 0})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null
              }
              empty={
                domainFilter === ALL_DOMAINS ? (
                  <EmptyState
                    icon={Mail}
                    title="No mailboxes yet"
                    description="Nothing on your mail server, and no sending accounts here either. Create one to give your team an address they can send and receive from."
                  />
                ) : (
                  <EmptyState
                    icon={Globe}
                    title={`No mailboxes on ${domainFilter}`}
                    description={`Your mail server has no addresses on ${domainFilter} yet — create the first one, or switch to another domain.`}
                  />
                )
              }
              noResults={
                <EmptyState
                  icon={Mail}
                  title="No matching mailboxes"
                  description="Try a different search."
                />
              }
              renderMobileRow={(mailbox) => {
                const grants = mailbox.smtpConnectionId
                  ? (grantsByConnection.get(mailbox.smtpConnectionId) ?? [])
                  : null;
                return (
                  <div className="flex items-start gap-3">
                    <Mail className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">
                          {mailbox.email}
                        </span>
                        {mailbox.isDefault ? <Badge>Default</Badge> : null}
                        {mailbox.origin === "SERVER_ONLY" ? (
                          <Badge variant="secondary">Not connected</Badge>
                        ) : null}
                        {mailbox.active === false ? (
                          <Badge variant="destructive">Disabled</Badge>
                        ) : null}
                      </div>
                      <p className="truncate text-body text-muted-foreground">
                        {mailbox.name}
                      </p>
                      <p className="mt-1 text-meta text-muted-foreground">
                        {grants === null
                          ? "QQueue can't send as this yet"
                          : grants.length === 0
                            ? "Admins only"
                            : `${grants.length} member(s) can send as this`}
                      </p>
                    </div>
                  </div>
                );
              }}
            />
          </TabsContent>

          <TabsContent value="access">
            <div className="space-y-3">
              <p className="text-body text-muted-foreground">
                Tick a box to let someone send as that mailbox. Owners and
                admins can always send as any of them, so their rows are locked.
              </p>
              <PermissionMatrix
                columnNoun="mailbox"
                emptyMessage={
                  connections.length === 0
                    ? "Create a mailbox first — then you can decide who sends as it."
                    : "Invite teammates from Settings, then come back to give them access."
                }
                columns={connections.map((connection) => ({
                  id: connection.id,
                  label: connection.fromEmail,
                  hint: `${connection.fromName || connection.name} · ${connection.fromEmail}`,
                }))}
                rows={members.map((member) => ({
                  id: member.userId,
                  name: memberName(member),
                  secondary: member.user.email,
                  alwaysAllowed: member.role !== "MEMBER",
                  alwaysAllowedReason: `${memberName(member)} is an ${member.role.toLowerCase()} and can send as every mailbox.`,
                }))}
                isGranted={(userId, connectionId) =>
                  grantedUserIds.has(`${userId}:${connectionId}`)
                }
                onToggle={toggleGrant}
                pending={pendingCells}
              />
            </div>
          </TabsContent>

          {isOwner ? (
            <TabsContent value="domains">
              <DomainAccessPanel
                admins={admins}
                domains={status?.domains ?? []}
                grants={domainGrantsQuery.data ?? []}
                loading={domainGrantsQuery.isPending}
                onGrant={(userId, domain) =>
                  addDomainGrant.mutate({ userId, domain })
                }
                onRevoke={(grant) => removeDomainGrant.mutate(grant)}
              />
            </TabsContent>
          ) : null}
        </Tabs>
      </PageContainer>

      <NewMailboxDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={organizationId ?? ""}
        domains={status?.domains ?? []}
        preferredDomain={domainFilter === ALL_DOMAINS ? null : domainFilter}
        restricted={Boolean(status?.restricted)}
        members={members}
        onProvisioned={(result) => {
          setCreateOpen(false);
          setRevealed({
            kind: "created",
            email: result.email,
            mailboxPassword: result.mailboxPassword,
            verified: result.verified,
          });
          void Promise.all(
            mailboxAndConnectionKeys.map((queryKey) =>
              queryClient.invalidateQueries({ queryKey })
            )
          );
        }}
      />

      <AdoptMailboxDialog
        mailbox={adopting}
        organizationId={organizationId ?? ""}
        members={members}
        onOpenChange={(open) => !open && setAdopting(null)}
        onAdopted={() => {
          setAdopting(null);
          void Promise.all(
            mailboxAndConnectionKeys.map((queryKey) =>
              queryClient.invalidateQueries({ queryKey })
            )
          );
        }}
      />

      <MailboxPasswordDialog
        result={revealed}
        mailHost={status?.mailHost ?? null}
        onClose={() => setRevealed(null)}
      />

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={
          confirming?.kind === "delete"
            ? `Delete ${confirming.mailbox.email}?`
            : confirming?.kind === "disable"
              ? `Stop delivery to ${confirming.mailbox.email}?`
              : `Reset the password for ${confirming?.mailbox.email}?`
        }
        description={
          confirming?.kind === "delete"
            ? "This permanently deletes the mailbox and everything in it from your mail server. Its QQueue sending account goes too. Mail already synced into your inbox is kept, and send history stays intact."
            : confirming?.kind === "disable"
              ? "Your mail server will refuse new mail for this address. Nothing already in the mailbox is deleted, and you can resume delivery whenever you like."
              : "Whoever reads this mailbox will be locked out of their mail app until you give them the new password. Sending from QQueue is unaffected — it uses a separate app password of its own."
        }
        confirmLabel={
          confirming?.kind === "delete"
            ? "Delete mailbox"
            : confirming?.kind === "disable"
              ? "Stop delivery"
              : "Reset password"
        }
        destructive={confirming?.kind === "delete"}
        loading={
          resetPassword.isPending ||
          setMailboxActive.isPending ||
          deleteMailbox.isPending
        }
        onConfirm={() => {
          if (!confirming) return;
          if (confirming.kind === "delete") {
            deleteMailbox.mutate(confirming.mailbox);
          } else if (confirming.kind === "disable") {
            mutateMailboxActive({ mailbox: confirming.mailbox, active: false });
          } else {
            resetPassword.mutate(confirming.mailbox);
          }
        }}
      />
    </>
  );
}

/**
 * Connect a mailbox that already exists on the mail server. Deliberately
 * narrower than creating one: the address is fixed, so the only open questions
 * are what recipients see in the From line and who may send as it.
 */
function AdoptMailboxDialog({
  mailbox,
  organizationId,
  members,
  onOpenChange,
  onAdopted,
}: {
  mailbox: MailboxSummary | null;
  organizationId: string;
  members: OrganizationMember[];
  onOpenChange: (open: boolean) => void;
  onAdopted: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [assignTo, setAssignTo] = useState(NO_ASSIGNEE);

  // Seed from whatever the mail server already calls this mailbox, and reset
  // between mailboxes so one adoption never leaks its answers into the next.
  useEffect(() => {
    if (mailbox) {
      setDisplayName(mailbox.name);
      setAssignTo(NO_ASSIGNEE);
    }
  }, [mailbox]);

  const adopt = useApiMutation(
    () =>
      api.adoptMailbox(mailbox!.email, {
        organizationId,
        name: displayName.trim() || undefined,
        assignToUserId: assignTo === NO_ASSIGNEE ? undefined : assignTo,
      }),
    {
      successMessage: (result) =>
        result.verified
          ? `${result.email} is connected and sending.`
          : `${result.email} is connected. The credentials haven't verified yet — use "Test connection" in a minute.`,
      errorMessage: "Couldn't connect that mailbox.",
      onSuccess: onAdopted,
    }
  );

  return (
    <Dialog open={mailbox !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect {mailbox?.email}</DialogTitle>
          <DialogDescription>
            This mailbox already exists on your mail server. Connecting it gives
            QQueue its own app password so the team can send from the address
            and replies show up in the inbox. The person's own mailbox password
            is untouched.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!adopt.isPending) adopt.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="adopt-mailbox-name">Display name</Label>
            <Input
              id="adopt-mailbox-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Support Team"
              autoFocus
            />
            <p className="text-meta text-muted-foreground">
              What recipients see in the From line. Optional.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Let someone send as this</Label>
            <Select value={assignTo} onValueChange={setAssignTo}>
              <SelectTrigger aria-label="Let someone send as this">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ASSIGNEE}>Nobody yet</SelectItem>
                {members.map((member) => (
                  <SelectItem key={member.userId} value={member.userId}>
                    {memberName(member)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-meta text-muted-foreground">
              You can change this any time on the "Who can send" tab.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={adopt.isPending}>
              {adopt.isPending ? <Spinner /> : <Link2 className="h-4 w-4" />}
              Connect mailbox
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewMailboxDialog({
  open,
  onOpenChange,
  organizationId,
  domains,
  preferredDomain,
  restricted,
  members,
  onProvisioned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  domains: string[];
  /** The domain the page is filtered to, or null when showing all of them. */
  preferredDomain: string | null;
  restricted: boolean;
  members: OrganizationMember[];
  onProvisioned: (result: MailboxProvisionResult) => void;
}) {
  const [localPart, setLocalPart] = useState("");
  const [domain, setDomain] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [assignTo, setAssignTo] = useState(NO_ASSIGNEE);

  // Open on whichever domain the page is filtered to, so "New mailbox" carries
  // on from what the user was already looking at. Deliberately keyed on `open`
  // rather than on `domains`, which a background refetch would replace — that
  // would yank the picker out from under someone mid-form.
  useEffect(() => {
    if (open && preferredDomain) {
      setDomain(preferredDomain);
    }
  }, [open, preferredDomain]);

  // This dialog mounts with the page, before the domain list has loaded, so
  // the initial state can't come from `domains`. Adopt the first one as soon
  // as it arrives — without it the form would open with nothing selected and
  // a permanently disabled submit button.
  useEffect(() => {
    if (!domain && domains.length > 0) {
      setDomain(domains[0]);
    }
  }, [domain, domains]);

  const provision = useApiMutation(
    () =>
      api.provisionMailbox({
        organizationId,
        localPart: localPart.trim(),
        domain,
        name: displayName.trim() || undefined,
        assignToUserId: assignTo === NO_ASSIGNEE ? undefined : assignTo,
      }) as Promise<MailboxProvisionResult>,
    {
      errorMessage: "Couldn't create that mailbox.",
      onSuccess: (result) => {
        setLocalPart("");
        setDisplayName("");
        setAssignTo(NO_ASSIGNEE);
        onProvisioned(result);
      },
    }
  );

  const address = localPart.trim() ? `${localPart.trim()}@${domain}` : null;
  const canSubmit =
    Boolean(domain) && localPart.trim().length > 0 && !provision.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New mailbox</DialogTitle>
          <DialogDescription>
            This creates a real mailbox on your mail server, connects it to
            QQueue for sending, and starts watching it for replies — all in one
            step.
          </DialogDescription>
        </DialogHeader>

        {/*
          One form wrapping the fields *and* the footer, so the submit button
          is a real descendant rather than relying on the `form` attribute.
        */}
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) provision.mutate();
          }}
        >
          {restricted && domains.length === 0 ? (
            <p className="rounded-card bg-muted p-3 text-body text-muted-foreground">
              You don't have access to any domains yet. Ask an owner to add you
              under Domain access.
            </p>
          ) : (
            <>
            <div className="space-y-2">
              <Label htmlFor="mailbox-local-part">Address</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="mailbox-local-part"
                  value={localPart}
                  onChange={(event) => setLocalPart(event.target.value)}
                  placeholder="support"
                  autoFocus
                  required
                />
                <span className="text-muted-foreground">@</span>
                <Select value={domain} onValueChange={setDomain}>
                  <SelectTrigger aria-label="Domain" className="w-44">
                    <SelectValue placeholder="Domain" />
                  </SelectTrigger>
                  <SelectContent>
                    {domains.map((candidate) => (
                      <SelectItem key={candidate} value={candidate}>
                        {candidate}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {address ? (
                <p className="text-meta text-muted-foreground">
                  Mail will arrive at <strong>{address}</strong>.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="mailbox-name">Display name</Label>
              <Input
                id="mailbox-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Support Team"
              />
              <p className="text-meta text-muted-foreground">
                What recipients see in the From line. Optional.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Let someone send as this</Label>
              <Select value={assignTo} onValueChange={setAssignTo}>
                <SelectTrigger aria-label="Let someone send as this">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ASSIGNEE}>Nobody yet</SelectItem>
                  {members.map((member) => (
                    <SelectItem key={member.userId} value={member.userId}>
                      {memberName(member)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-meta text-muted-foreground">
                You can change this any time on the "Who can send" tab.
              </p>
            </div>
            </>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {provision.isPending ? <Spinner /> : <Plus className="h-4 w-4" />}
              Create mailbox
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The one and only sight of a mailbox password, after creating a mailbox or
 * resetting one. Both cases say the same important thing — this is the human's
 * mail-client password, not the credential QQueue sends with — so they share a
 * dialog rather than drifting apart.
 */
function MailboxPasswordDialog({
  result,
  mailHost,
  onClose,
}: {
  result: RevealedPassword | null;
  mailHost: string | null;
  onClose: () => void;
}) {
  const created = result?.kind === "created";

  return (
    <Dialog open={result !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {created
              ? `${result?.email} is ready`
              : `New password for ${result?.email}`}
          </DialogTitle>
          <DialogDescription>
            {created
              ? `Give this password to whoever owns the mailbox so they can add it to their own mail app${mailHost ? ` (server: ${mailHost})` : ""}. It's shown once and never again — QQueue keeps a separate password of its own for sending, so nothing breaks if this one is lost.`
              : `The old password no longer works. Give this one to whoever reads the mailbox${mailHost ? ` (server: ${mailHost})` : ""} — it's shown once and never again. Sending and inbox sync carried on uninterrupted; they use a separate password of QQueue's own.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <code className="flex-1 select-all rounded-card bg-muted px-3 py-2 font-mono text-body">
            {result?.mailboxPassword}
          </code>
          <IconButton
            label="Copy password"
            variant="outline"
            onClick={async () => {
              if (!result) return;
              try {
                await navigator.clipboard.writeText(result.mailboxPassword);
                toast.success("Password copied.");
              } catch {
                toast.error("Couldn't copy — select the text and copy it.");
              }
            }}
          >
            <Copy />
          </IconButton>
        </div>

        {result && result.verified === false ? (
          <p className="rounded-card bg-warning/10 p-3 text-body text-warning-foreground">
            The sending credentials haven't verified yet — your mail server may
            still be activating the mailbox. Everything is saved; use "Test
            connection" on this page in a minute to re-check.
          </p>
        ) : null}

        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DomainAccessPanel({
  admins,
  domains,
  grants,
  loading,
  onGrant,
  onRevoke,
}: {
  admins: OrganizationMember[];
  domains: string[];
  grants: MailDomainGrant[];
  loading: boolean;
  onGrant: (userId: string, domain: string) => void;
  onRevoke: (grant: MailDomainGrant) => void;
}) {
  const [picks, setPicks] = useState<Record<string, string>>({});

  if (loading) {
    return <p className="p-6 text-body text-muted-foreground">Loading…</p>;
  }

  if (admins.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Globe}
          title="No admins to restrict"
          description="You can create mailboxes on every domain. This tab matters once you have admins — it's how you decide which domains each of them may use."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-body text-muted-foreground">
        You can create mailboxes on every domain. Admins can only use the
        domains you list here.
      </p>

      <div className="overflow-x-auto rounded-dialog border">
        <table className="w-full text-body">
          <thead className="border-b bg-muted/60">
            <tr>
              <th
                scope="col"
                className="px-3 py-2 text-left text-meta font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Admin
              </th>
              <th
                scope="col"
                className="px-3 py-2 text-left text-meta font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Domains they can use
              </th>
              <th
                scope="col"
                className="w-72 px-3 py-2 text-left text-meta font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Add a domain
              </th>
            </tr>
          </thead>
          <tbody>
            {admins.map((admin) => {
              const theirs = grants.filter(
                (grant) => grant.userId === admin.userId
              );
              const held = new Set(theirs.map((grant) => grant.domain));
              const available = domains.filter(
                (candidate) => !held.has(candidate.toLowerCase())
              );
              const pick = picks[admin.userId] ?? "";

              return (
                <tr key={admin.userId} className="border-b last:border-0">
                  <td className="px-3 py-3 align-top">
                    <div className="font-medium">{memberName(admin)}</div>
                    <div className="text-meta text-muted-foreground">
                      {admin.user.email}
                    </div>
                  </td>
                  <td className="px-3 py-3 align-top">
                    {theirs.length === 0 ? (
                      <span className="text-muted-foreground">
                        None — they can't create mailboxes yet.
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-field">
                        {theirs.map((grant) => (
                          <Badge
                            key={grant.id}
                            variant="secondary"
                            className="gap-1 pr-1"
                          >
                            {grant.domain}
                            <IconButton
                              label={`Remove ${grant.domain} from ${memberName(admin)}`}
                              size="sm"
                              variant="destructive"
                              className="h-5 w-5"
                              onClick={() => onRevoke(grant)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </IconButton>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 align-top">
                    <div className="flex items-center gap-2">
                      <Select
                        value={pick}
                        onValueChange={(value) =>
                          setPicks((current) => ({
                            ...current,
                            [admin.userId]: value,
                          }))
                        }
                        disabled={available.length === 0}
                      >
                        <SelectTrigger
                          aria-label={`Choose a domain for ${memberName(admin)}`}
                        >
                          <SelectValue
                            placeholder={
                              available.length === 0
                                ? "All domains granted"
                                : "Choose a domain"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {available.map((candidate) => (
                            <SelectItem key={candidate} value={candidate}>
                              {candidate}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        disabled={!pick}
                        onClick={() => {
                          onGrant(admin.userId, pick);
                          setPicks((current) => ({
                            ...current,
                            [admin.userId]: "",
                          }));
                        }}
                      >
                        Add
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
