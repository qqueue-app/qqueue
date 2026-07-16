import { FormEvent, useEffect, useState } from "react";
import { Copy, Mail, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type OrganizationInvite,
  type OrganizationMember,
} from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { EmptyState } from "./EmptyState.js";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert.js";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog.js";
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";
import { Input } from "./ui/input.js";
import { Label } from "./ui/label.js";
import { Separator } from "./ui/separator.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select.js";
import { Spinner } from "./ui/spinner.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table.js";

type InviteRole = "OWNER" | "ADMIN" | "MEMBER";

function roleBadgeVariant(role: string) {
  if (role === "OWNER") return "success" as const;
  if (role === "ADMIN") return "secondary" as const;
  return "outline" as const;
}

function titleCaseRole(role: string) {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

/**
 * Team management for the active organization: current members (change role /
 * remove) and pending invitations (issue / revoke). Visible only to OWNER/ADMIN
 * — everyone else gets no card. The API is the authority on every guardrail
 * (last-owner protection, who may grant OWNER); this UI just avoids obviously
 * invalid actions and surfaces server errors.
 */
export function TeamCard() {
  const { user, currentOrganizationId, currentOrganization } = useSession();
  const actorRole = currentOrganization?.role;
  const canManage = actorRole === "OWNER" || actorRole === "ADMIN";
  const isOwner = actorRole === "OWNER";

  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invites, setInvites] = useState<OrganizationInvite[]>([]);
  const [loading, setLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("MEMBER");
  const [inviting, setInviting] = useState(false);
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);
  const [savingRoleFor, setSavingRoleFor] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<OrganizationMember | null>(
    null
  );
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (!currentOrganizationId || !canManage) {
      setMembers([]);
      setInvites([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.listOrganizationMembers(currentOrganizationId),
      api.listInvites(currentOrganizationId),
    ])
      .then(([memberList, inviteList]) => {
        if (cancelled) return;
        setMembers(memberList);
        setInvites(inviteList);
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(
            error instanceof Error ? error.message : "Unable to load team"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentOrganizationId, canManage]);

  if (!canManage) {
    return null;
  }

  const ownerCount = members.filter((m) => m.role === "OWNER").length;

  async function createInvite(event: FormEvent) {
    event.preventDefault();
    if (!currentOrganizationId) return;
    setInviting(true);
    try {
      const result = await api.createInvite({
        organizationId: currentOrganizationId,
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      setInvites((current) => [result.invite, ...current]);
      setCreatedInviteUrl(result.acceptUrl);
      setInviteEmail("");
      setInviteRole("MEMBER");
      toast.success(`Invitation sent to ${result.invite.email}.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to create invitation"
      );
    } finally {
      setInviting(false);
    }
  }

  async function copyInviteUrl() {
    if (!createdInviteUrl) return;
    try {
      await navigator.clipboard.writeText(createdInviteUrl);
      toast.success("Invite link copied.");
    } catch {
      toast.error("Unable to copy invite link.");
    }
  }

  async function revokeInvite(invite: OrganizationInvite) {
    try {
      await api.revokeInvite(invite.id);
      setInvites((current) => current.filter((i) => i.id !== invite.id));
      toast.success("Invitation revoked.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to revoke invitation"
      );
    }
  }

  async function changeRole(member: OrganizationMember, role: string) {
    if (!currentOrganizationId || role === member.role) return;
    setSavingRoleFor(member.userId);
    try {
      const updated = await api.updateMemberRole(
        currentOrganizationId,
        member.userId,
        role
      );
      setMembers((current) =>
        current.map((m) => (m.userId === updated.userId ? updated : m))
      );
      toast.success(`Role updated to ${titleCaseRole(role)}.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to change role"
      );
    } finally {
      setSavingRoleFor(null);
    }
  }

  async function removeMember() {
    if (!currentOrganizationId || !removeTarget) return;
    setRemoving(true);
    try {
      await api.removeMember(currentOrganizationId, removeTarget.userId);
      setMembers((current) =>
        current.filter((m) => m.userId !== removeTarget.userId)
      );
      toast.success("Member removed.");
      setRemoveTarget(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to remove member"
      );
    } finally {
      setRemoving(false);
    }
  }

  // Role options the current actor is allowed to assign (only an OWNER can grant
  // OWNER). The server re-checks regardless.
  const assignableRoles: InviteRole[] = isOwner
    ? ["OWNER", "ADMIN", "MEMBER"]
    : ["ADMIN", "MEMBER"];

  function canEditMember(member: OrganizationMember) {
    // Admins cannot touch owners.
    return !(actorRole === "ADMIN" && member.role === "OWNER");
  }

  function isLastOwner(member: OrganizationMember) {
    return member.role === "OWNER" && ownerCount <= 1;
  }

  return (
    <>
      <Card className="h-fit lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Team
          </CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">
            Invite people to this organization and manage member roles.
            Invitations work even when public registration is closed.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {createdInviteUrl ? (
            <Alert variant="warning">
              <AlertTitle>Invitation link</AlertTitle>
              <AlertDescription>
                <p className="mt-1 text-sm">
                  We emailed this link to the invitee. You can also share it
                  directly — it expires in 7 days.
                </p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-background px-3 py-2 text-xs">
                    {createdInviteUrl}
                  </code>
                  <Button type="button" variant="outline" onClick={copyInviteUrl}>
                    <Copy className="h-4 w-4" />
                    Copy
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}

          <form
            onSubmit={createInvite}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="invite-email">Invite by email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="teammate@example.com"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select
                value={inviteRole}
                onValueChange={(value) => setInviteRole(value as InviteRole)}
              >
                <SelectTrigger id="invite-role" className="w-full sm:w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {assignableRoles.map((role) => (
                    <SelectItem key={role} value={role}>
                      {titleCaseRole(role)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="submit"
              disabled={inviting || !currentOrganizationId || !inviteEmail.trim()}
            >
              {inviting ? <Spinner /> : <Mail className="h-4 w-4" />}
              Invite
            </Button>
          </form>

          <Separator />

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              Loading team
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <h3 className="text-sm font-medium">Members</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead className="w-16" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((member) => {
                      const isSelf = member.userId === user?.id;
                      const editable = canEditMember(member);
                      const lockedOwner = isLastOwner(member);
                      return (
                        <TableRow key={member.id}>
                          <TableCell>
                            <div className="font-medium">
                              {member.user.name ?? member.user.email}
                              {isSelf ? (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  (you)
                                </span>
                              ) : null}
                            </div>
                            {member.user.name ? (
                              <div className="mt-0.5 text-xs text-muted-foreground">
                                {member.user.email}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            {editable && !lockedOwner ? (
                              <Select
                                value={member.role}
                                disabled={savingRoleFor === member.userId}
                                onValueChange={(value) =>
                                  void changeRole(member, value)
                                }
                              >
                                <SelectTrigger className="w-32">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {assignableRoles.map((role) => (
                                    <SelectItem key={role} value={role}>
                                      {titleCaseRole(role)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Badge variant={roleBadgeVariant(member.role)}>
                                {titleCaseRole(member.role)}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={!editable || lockedOwner}
                              onClick={() => setRemoveTarget(member)}
                              aria-label={`Remove ${member.user.email}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-medium">Pending invitations</h3>
                {invites.length === 0 ? (
                  <EmptyState
                    icon={Mail}
                    title="No pending invitations"
                    description="Invite a teammate by email above to add them to this organization."
                    className="border bg-muted/20"
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead className="w-16" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invites.map((invite) => (
                        <TableRow key={invite.id}>
                          <TableCell className="font-medium">
                            {invite.email}
                          </TableCell>
                          <TableCell>
                            <Badge variant={roleBadgeVariant(invite.role)}>
                              {titleCaseRole(invite.role)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => void revokeInvite(invite)}
                              aria-label={`Revoke invitation for ${invite.email}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget?.user.email} will lose access to this organization.
              They can be invited back later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removing}
              onClick={(event) => {
                event.preventDefault();
                void removeMember();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removing ? <Spinner /> : null}
              Remove member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
