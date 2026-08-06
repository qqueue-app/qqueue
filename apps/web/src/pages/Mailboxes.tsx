import { useCallback, useEffect, useState } from "react";
import { Copy, Mail, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import {
  api,
  type MailboxProvisionResult,
  type MailcowStatus,
  type OrganizationMember,
  type SMTPConnection,
  type SmtpConnectionGrant,
} from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent } from "../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Skeleton } from "../components/ui/skeleton.js";
import { Spinner } from "../components/ui/spinner.js";

const NO_ASSIGNEE = "__none__";

function memberLabel(member: OrganizationMember) {
  return member.user.name
    ? `${member.user.name} (${member.user.email})`
    : member.user.email;
}

/**
 * Mailboxes (Phase 4): OWNER/ADMIN provision team mailboxes on the instance's
 * Mailcow and manage who may send as each connection. Members never see this
 * page (nav hides it; the API enforces).
 */
export function Mailboxes() {
  const { currentOrganizationId: organizationId, currentOrganization } =
    useSession();
  const canManage =
    currentOrganization?.role === "OWNER" ||
    currentOrganization?.role === "ADMIN";

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<MailcowStatus | null>(null);
  const [connections, setConnections] = useState<SMTPConnection[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [grants, setGrants] = useState<Record<string, SmtpConnectionGrant[]>>(
    {}
  );

  // Provision form state.
  const [localPart, setLocalPart] = useState("");
  const [domain, setDomain] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [assignTo, setAssignTo] = useState<string>(NO_ASSIGNEE);
  const [provisioning, setProvisioning] = useState(false);
  const [provisioned, setProvisioned] = useState<MailboxProvisionResult | null>(
    null
  );

  // Per-connection grant picker state.
  const [grantPick, setGrantPick] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!organizationId || !canManage) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [statusData, connectionData, memberData] = await Promise.all([
        api.getMailcowStatus(organizationId),
        api.listSMTPConnections(organizationId),
        api.listOrganizationMembers(organizationId),
      ]);
      setStatus(statusData);
      setConnections(connectionData);
      setMembers(memberData);
      if (!statusData.configured && statusData.domains.length === 0) {
        setDomain("");
      } else if (statusData.domains.length > 0) {
        setDomain((current) => current || statusData.domains[0]);
      }

      const grantLists = await Promise.all(
        connectionData.map((connection) =>
          api.listConnectionGrants(connection.id).catch(() => [])
        )
      );
      setGrants(
        Object.fromEntries(
          connectionData.map((connection, index) => [
            connection.id,
            grantLists[index],
          ])
        )
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't load mailboxes."
      );
    } finally {
      setLoading(false);
    }
  }, [organizationId, canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function provision(event: React.FormEvent) {
    event.preventDefault();
    if (!organizationId || !domain || !localPart.trim()) return;
    setProvisioning(true);
    try {
      const result = await api.provisionMailbox({
        organizationId,
        localPart: localPart.trim(),
        domain,
        name: displayName.trim() || undefined,
        assignToUserId: assignTo === NO_ASSIGNEE ? undefined : assignTo,
      });
      setProvisioned(result);
      setLocalPart("");
      setDisplayName("");
      setAssignTo(NO_ASSIGNEE);
      toast.success(`${result.email} is ready.`);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Provisioning failed."
      );
    } finally {
      setProvisioning(false);
    }
  }

  async function addGrant(connectionId: string) {
    const userId = grantPick[connectionId];
    if (!userId) return;
    try {
      await api.addConnectionGrant(connectionId, userId);
      setGrantPick((current) => ({ ...current, [connectionId]: "" }));
      const updated = await api.listConnectionGrants(connectionId);
      setGrants((current) => ({ ...current, [connectionId]: updated }));
      toast.success("Send-as access granted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to grant.");
    }
  }

  async function removeGrant(connectionId: string, userId: string) {
    try {
      await api.removeConnectionGrant(connectionId, userId);
      setGrants((current) => ({
        ...current,
        [connectionId]: (current[connectionId] ?? []).filter(
          (grant) => grant.userId !== userId
        ),
      }));
      toast.success("Send-as access removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to remove.");
    }
  }

  async function copyPassword() {
    if (!provisioned) return;
    try {
      await navigator.clipboard.writeText(provisioned.mailboxPassword);
      toast.success("Password copied.");
    } catch {
      toast.error("Couldn't copy — select and copy it by hand.");
    }
  }

  if (!canManage) {
    return (
      <>
        <PageHeader
          title="Mailboxes"
          description="Provision team mailboxes and manage who can send as them."
        />
        <section className="p-6">
          <Card>
            <EmptyState
              icon={Mail}
              title="Owners and admins only"
              description="Ask an owner or admin to provision mailboxes or grant you send-as access."
            />
          </Card>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Mailboxes"
        description="Provision team mailboxes on your mail server and choose who can send as each account."
      />

      <section className="space-y-6 p-6">
        {loading ? (
          <Card>
            <CardContent className="p-5">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="mt-2 h-4 w-64" />
            </CardContent>
          </Card>
        ) : !status?.configured ? (
          <Card>
            <EmptyState
              icon={Mail}
              title="Mailcow is not connected"
              description="Set MAILCOW_API_URL and MAILCOW_API_KEY in the instance's .env to provision mailboxes from here. Sending accounts can still be added manually."
            />
          </Card>
        ) : (
          <>
            {!status.reachable ? (
              <Card>
                <CardContent className="p-5 text-sm text-destructive">
                  Mailcow is configured but unreachable
                  {status.error ? `: ${status.error}` : "."}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-5">
                  <h2 className="font-semibold">New mailbox</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Creates the mailbox in Mailcow, connects it for sending and
                    bounce tracking, and can grant a member send-as access — all
                    in one step.
                  </p>
                  <form
                    className="mt-4 grid gap-4 sm:grid-cols-2"
                    onSubmit={provision}
                  >
                    <div className="space-y-2">
                      <Label htmlFor="mailbox-local-part">Address</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id="mailbox-local-part"
                          value={localPart}
                          onChange={(event) => setLocalPart(event.target.value)}
                          placeholder="ama"
                          required
                        />
                        <span className="text-muted-foreground">@</span>
                        <Select value={domain} onValueChange={setDomain}>
                          <SelectTrigger aria-label="Domain">
                            <SelectValue placeholder="Domain" />
                          </SelectTrigger>
                          <SelectContent>
                            {status.domains.map((candidate) => (
                              <SelectItem key={candidate} value={candidate}>
                                {candidate}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="mailbox-name">Display name</Label>
                      <Input
                        id="mailbox-name"
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        placeholder="Ama Mensah"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Grant send-as to</Label>
                      <Select value={assignTo} onValueChange={setAssignTo}>
                        <SelectTrigger aria-label="Grant send-as to">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_ASSIGNEE}>
                            No one yet
                          </SelectItem>
                          {members.map((member) => (
                            <SelectItem
                              key={member.userId}
                              value={member.userId}
                            >
                              {memberLabel(member)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end">
                      <Button
                        type="submit"
                        disabled={provisioning || !domain || !localPart.trim()}
                      >
                        {provisioning ? (
                          <Spinner />
                        ) : (
                          <Plus className="h-4 w-4" />
                        )}
                        Provision mailbox
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}

            <div className="space-y-3">
              <h2 className="font-semibold">Send-as access</h2>
              {connections.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={Mail}
                    title="No sending accounts yet"
                    description="Provision a mailbox above, or add a sending account manually."
                  />
                </Card>
              ) : (
                connections.map((connection) => {
                  const connectionGrants = grants[connection.id] ?? [];
                  const grantedIds = new Set(
                    connectionGrants.map((grant) => grant.userId)
                  );
                  const grantable = members.filter(
                    (member) =>
                      member.role === "MEMBER" && !grantedIds.has(member.userId)
                  );
                  return (
                    <Card key={connection.id}>
                      <CardContent className="p-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">{connection.name}</h3>
                          <span className="text-sm text-muted-foreground">
                            {connection.fromEmail}
                          </span>
                          {connection.isDefault ? <Badge>Default</Badge> : null}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Owners and admins can always send as this account.
                          Members need a grant.
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {connectionGrants.length === 0 ? (
                            <span className="text-sm text-muted-foreground">
                              No member grants.
                            </span>
                          ) : (
                            connectionGrants.map((grant) => (
                              <Badge
                                key={grant.id}
                                variant="secondary"
                                className="flex items-center gap-1"
                              >
                                {grant.user?.name ??
                                  grant.user?.email ??
                                  grant.userId}
                                <button
                                  type="button"
                                  aria-label={`Remove send-as for ${grant.user?.email ?? grant.userId}`}
                                  onClick={() =>
                                    removeGrant(connection.id, grant.userId)
                                  }
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </Badge>
                            ))
                          )}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Select
                            value={grantPick[connection.id] ?? ""}
                            onValueChange={(value) =>
                              setGrantPick((current) => ({
                                ...current,
                                [connection.id]: value,
                              }))
                            }
                          >
                            <SelectTrigger
                              className="w-64"
                              aria-label={`Grant member for ${connection.fromEmail}`}
                            >
                              <SelectValue placeholder="Choose a member" />
                            </SelectTrigger>
                            <SelectContent>
                              {grantable.length === 0 ? (
                                <SelectItem value="__empty__" disabled>
                                  Every member already has access
                                </SelectItem>
                              ) : (
                                grantable.map((member) => (
                                  <SelectItem
                                    key={member.userId}
                                    value={member.userId}
                                  >
                                    {memberLabel(member)}
                                  </SelectItem>
                                ))
                              )}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={!grantPick[connection.id]}
                            onClick={() => addGrant(connection.id)}
                          >
                            Grant send-as
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          </>
        )}
      </section>

      <Dialog
        open={provisioned !== null}
        onOpenChange={(open) => !open && setProvisioned(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{provisioned?.email} is ready</DialogTitle>
            <DialogDescription>
              Share the mailbox password with its owner for their mail client
              {status?.mailHost ? ` (server: ${status.mailHost})` : ""}. It is
              shown only this once — QQueue keeps its own app password and never
              stores this one.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-muted px-3 py-2 font-mono text-sm">
              {provisioned?.mailboxPassword}
            </code>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={copyPassword}
              aria-label="Copy mailbox password"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          {provisioned && !provisioned.verified ? (
            <p className="text-sm text-amber-600 dark:text-amber-500">
              The sending credentials haven&apos;t verified yet — Mailcow may
              still be activating the mailbox. Everything is saved; use Test
              connection on the Sending accounts page to re-check in a minute.
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
