import { useEffect, useMemo, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Copy,
  Globe,
  Mail,
  Plus,
  Server,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { PermissionMatrix } from "../components/PermissionMatrix.js";
import {
  api,
  type MailDomainGrant,
  type MailboxProvisionResult,
  type OrganizationMember,
  type SMTPConnection,
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

function memberName(member: OrganizationMember) {
  return member.user.name ?? member.user.email;
}

function domainOf(email: string) {
  return email.split("@")[1] ?? "";
}

/**
 * Mailboxes — where an owner or admin creates team mailboxes and decides who
 * may send as each one.
 *
 * Three questions, three tabs: what mailboxes exist, who can send as them, and
 * (owners only) which domains each admin may create mailboxes on. The access
 * question is answered by a people × mailboxes grid rather than a per-mailbox
 * grant form, so the whole picture is visible at once.
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
  const [provisioned, setProvisioned] = useState<MailboxProvisionResult | null>(
    null
  );
  const [pendingCells, setPendingCells] = useState<Set<string>>(new Set());

  const statusQuery = useOrgQuery(
    canManage ? organizationId : null,
    qk.mailcowStatus(organizationId ?? ""),
    (id) => api.getMailcowStatus(id)
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

  const loading =
    statusQuery.isPending ||
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

  const mailboxColumns = useMemo<ColumnDef<SMTPConnection, unknown>[]>(
    () => [
      {
        accessorKey: "fromEmail",
        header: "Address",
        meta: { title: "Address" },
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">
                {row.original.fromEmail}
              </span>
              {row.original.isDefault ? (
                <Hint label="New mail sends from this account unless another is chosen">
                  <Badge className="cursor-help">Default</Badge>
                </Hint>
              ) : null}
            </div>
            <div className="truncate text-xs text-muted-foreground md:hidden">
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
          <span className="text-muted-foreground">
            {row.original.fromName || row.original.name}
          </span>
        ),
      },
      {
        id: "domain",
        accessorFn: (row) => domainOf(row.fromEmail),
        header: "Domain",
        meta: { title: "Domain", hideBelowLg: true },
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{String(getValue())}</span>
        ),
      },
      {
        id: "server",
        accessorFn: (row) => `${row.host}:${row.port}`,
        header: "Server",
        meta: { title: "Server", hideBelowLg: true },
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {String(getValue())}
          </span>
        ),
      },
      {
        id: "access",
        header: "Who can send",
        meta: { title: "Who can send", align: "center" },
        // Sorts by how many people hold a grant, so "nobody has access to this
        // mailbox" surfaces at one end of the sort.
        accessorFn: (row) => grantsByConnection.get(row.id)?.length ?? 0,
        cell: ({ row, getValue }) => {
          const count = Number(getValue());
          const names = (grantsByConnection.get(row.original.id) ?? [])
            .map((grant) => grant.user?.name ?? grant.user?.email ?? "someone")
            .join(", ");
          return (
            <Hint
              label={
                count === 0
                  ? "Only owners and admins, who can always send as any account"
                  : `Owners and admins, plus ${names}`
              }
            >
              <span className="inline-flex cursor-help items-center gap-1.5 text-sm text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                {count === 0 ? "Admins only" : `+${count}`}
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
        cell: ({ row }) => (
          <RowActions
            rowLabel={row.original.fromEmail}
            actions={[
              {
                label: "Test connection",
                icon: ShieldCheck,
                onSelect: async () => {
                  const toastId = toast.loading("Testing connection…");
                  try {
                    await api.verifySMTPConnection(row.original.id);
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
                  await navigator.clipboard.writeText(row.original.fromEmail);
                  toast.success("Address copied.");
                },
              },
            ]}
          />
        ),
      },
    ],
    [grantsByConnection]
  );

  if (!canManage) {
    return (
      <>
        <PageHeader
          title="Mailboxes"
          description="Create team mailboxes and choose who can send as them."
        />
        <section className="p-4 sm:p-6">
          <Card>
            <EmptyState
              icon={Mail}
              title="Owners and admins only"
              description="Ask an owner or admin to create a mailbox for you, or to let you send as an existing one."
            />
          </Card>
        </section>
      </>
    );
  }

  const admins = members.filter((member) => member.role === "ADMIN");

  return (
    <>
      <PageHeader
        title="Mailboxes"
        description="Create team mailboxes on your mail server and choose who can send as each one."
        actions={
          status?.configured && status.reachable ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              New mailbox
            </Button>
          ) : null
        }
      />

      <section className="p-4 sm:p-6">
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
            <CardContent className="flex items-start gap-3 p-5">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div>
                <p className="font-medium">Your mail server isn't answering</p>
                <p className="mt-1 text-sm text-muted-foreground">
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
              data={connections}
              columns={mailboxColumns}
              getRowId={(row) => row.id}
              loading={loading}
              searchPlaceholder="Search mailboxes…"
              empty={
                <EmptyState
                  icon={Mail}
                  title="No mailboxes yet"
                  description="Create one to give your team an address they can send and receive from."
                />
              }
              noResults={
                <EmptyState
                  icon={Mail}
                  title="No matching mailboxes"
                  description="Try a different search."
                />
              }
              renderMobileRow={(connection) => (
                <div className="flex items-start gap-3">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">
                        {connection.fromEmail}
                      </span>
                      {connection.isDefault ? <Badge>Default</Badge> : null}
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {connection.fromName || connection.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {(grantsByConnection.get(connection.id) ?? []).length ===
                      0
                        ? "Admins only"
                        : `${grantsByConnection.get(connection.id)!.length} member(s) can send as this`}
                    </p>
                  </div>
                </div>
              )}
            />
          </TabsContent>

          <TabsContent value="access">
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
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
      </section>

      <NewMailboxDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={organizationId ?? ""}
        domains={status?.domains ?? []}
        restricted={Boolean(status?.restricted)}
        members={members}
        onProvisioned={(result) => {
          setCreateOpen(false);
          setProvisioned(result);
          void queryClient.invalidateQueries({
            queryKey: qk.smtpConnections(organizationId ?? ""),
          });
        }}
      />

      <MailboxPasswordDialog
        result={provisioned}
        mailHost={status?.mailHost ?? null}
        onClose={() => setProvisioned(null)}
      />
    </>
  );
}

function NewMailboxDialog({
  open,
  onOpenChange,
  organizationId,
  domains,
  restricted,
  members,
  onProvisioned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  domains: string[];
  restricted: boolean;
  members: OrganizationMember[];
  onProvisioned: (result: MailboxProvisionResult) => void;
}) {
  const [localPart, setLocalPart] = useState("");
  const [domain, setDomain] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [assignTo, setAssignTo] = useState(NO_ASSIGNEE);

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
            <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
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
                  placeholder="ama"
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
                <p className="text-xs text-muted-foreground">
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
                placeholder="Ama Mensah"
              />
              <p className="text-xs text-muted-foreground">
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
              <p className="text-xs text-muted-foreground">
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

function MailboxPasswordDialog({
  result,
  mailHost,
  onClose,
}: {
  result: MailboxProvisionResult | null;
  mailHost: string | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={result !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{result?.email} is ready</DialogTitle>
          <DialogDescription>
            Give this password to whoever owns the mailbox so they can add it to
            their own mail app
            {mailHost ? ` (server: ${mailHost})` : ""}. It's shown once and
            never again — QQueue keeps a separate password of its own for
            sending, so nothing breaks if this one is lost.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <code className="flex-1 select-all rounded-lg bg-muted px-3 py-2.5 font-mono text-sm">
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

        {result && !result.verified ? (
          <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning-foreground">
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
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
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
      <p className="text-sm text-muted-foreground">
        You can create mailboxes on every domain. Admins can only use the
        domains you list here.
      </p>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/60">
            <tr>
              <th
                scope="col"
                className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Admin
              </th>
              <th
                scope="col"
                className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Domains they can use
              </th>
              <th
                scope="col"
                className="w-72 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
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
                    <div className="text-xs text-muted-foreground">
                      {admin.user.email}
                    </div>
                  </td>
                  <td className="px-3 py-3 align-top">
                    {theirs.length === 0 ? (
                      <span className="text-muted-foreground">
                        None — they can't create mailboxes yet.
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
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
