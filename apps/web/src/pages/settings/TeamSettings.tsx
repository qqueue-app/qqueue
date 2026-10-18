import { PageContainer } from "../../components/PageContainer.js";
import { FormEvent, useEffect, useRef, useState } from "react";
import { KeyRound, Mail, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../../components/PageHeader.js";
import { CopyableSecret } from "../../components/settings/CopyableSecret.js";
import {
  Field,
  FormSection,
  FormSections,
} from "../../components/settings/FormLayout.js";
import { Badge } from "../../components/ui/badge.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Label } from "../../components/ui/label.js";
import { RowActions } from "../../components/ui/row-actions.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import { Spinner } from "../../components/ui/spinner.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { EmptyState } from "../../components/EmptyState.js";
import {
  api,
  type OrganizationInvite,
  type OrganizationMember,
} from "../../lib/api.js";
import { useSession } from "../../lib/session-context.js";
import { useApiMutation, useOrgQuery } from "../../lib/use-api.js";
import { qk } from "../../lib/query-client.js";

type InviteRole = "OWNER" | "ADMIN" | "MEMBER";

function roleBadgeVariant(role: string) {
  if (role === "OWNER") return "ok" as const;
  if (role === "ADMIN") return "neutral" as const;
  return "outline" as const;
}

function titleCaseRole(role: string) {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

/**
 * Members and invitations for the active organization.
 *
 * Rows, not a table. A members list is three fields wide and a table of it
 * needs a card layout below 640px anyway (§5) — so it is built as settings
 * rows from the start, which read identically at 375px and 1280px and never
 * grow a horizontal scrollbar in between.
 *
 * The API is the authority on every guardrail (last-owner protection, who may
 * grant OWNER); this page only avoids obviously invalid actions and surfaces
 * server errors.
 */
export function TeamSettings() {
  const { user, currentOrganizationId, currentOrganization } = useSession();
  const actorRole = currentOrganization?.role;
  const canManage = actorRole === "OWNER" || actorRole === "ADMIN";
  const isOwner = actorRole === "OWNER";
  const resetPassword = useApiMutation(
    (email: string) => api.requestPasswordReset({ email }),
    {
      successMessage:
        "Sign-in reset email requested. The link expires in one hour.",
      errorMessage: "Couldn't request a reset email.",
    }
  );

  const queryClient = useQueryClient();
  const orgRef = useRef(currentOrganizationId);
  orgRef.current = currentOrganizationId;
  const membersQuery = useOrgQuery(
    currentOrganizationId,
    qk.members(currentOrganizationId ?? ""),
    (id) => api.listOrganizationMembers(id),
    { enabled: canManage }
  );
  const invitesQuery = useOrgQuery(
    currentOrganizationId,
    qk.invites(currentOrganizationId ?? ""),
    (id) => api.listInvites(id),
    { enabled: canManage }
  );
  const mailboxesQuery = useOrgQuery(
    currentOrganizationId,
    qk.sendableSmtpConnections(currentOrganizationId ?? ""),
    (id) => api.listSendableSMTPConnections(id),
    { enabled: canManage }
  );
  const mailboxes = mailboxesQuery.data ?? [];
  const [inviteMailboxIds, setInviteMailboxIds] = useState<string[]>([]);
  const members = membersQuery.data ?? [];
  const invites = invitesQuery.data ?? [];
  const loading = membersQuery.isPending || invitesQuery.isPending;
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("MEMBER");
  const [inviting, setInviting] = useState(false);
  const [createdInvite, setCreatedInvite] = useState<{
    organizationId: string;
    inviteId: string;
    url: string;
    emailQueued: boolean;
  } | null>(null);
  const [savingRoleFor, setSavingRoleFor] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<OrganizationMember | null>(
    null
  );
  const [removing, setRemoving] = useState(false);
  const createdInviteUrl =
    createdInvite && createdInvite.organizationId === currentOrganizationId
      ? createdInvite.url
      : null;
  useEffect(() => {
    setCreatedInvite(null);
    setInviteEmail("");
    setInviteRole("MEMBER");
    setInviteMailboxIds([]);
    setRemoveTarget(null);
  }, [currentOrganizationId]);

  async function refreshTeam(organizationId: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.members(organizationId) }),
      queryClient.invalidateQueries({ queryKey: qk.invites(organizationId) }),
    ]);
  }

  const ownerCount = members.filter((m) => m.role === "OWNER").length;

  async function issueInvite(
    email: string,
    role: InviteRole,
    smtpConnectionIds: string[] = []
  ) {
    const organizationId = currentOrganizationId;
    if (!organizationId) return;
    setInviting(true);
    try {
      const result = await api.createInvite({
        organizationId,
        email,
        role,
        ...(smtpConnectionIds.length ? { smtpConnectionIds } : {}),
      });
      await refreshTeam(organizationId);
      if (orgRef.current !== organizationId) return;
      setCreatedInvite({
        organizationId,
        inviteId: result.invite.id,
        url: result.acceptUrl,
        emailQueued: result.emailQueued,
      });
      setInviteEmail("");
      setInviteRole("MEMBER");
      setInviteMailboxIds([]);
      toast.success(
        result.emailQueued
          ? `Invitation email queued for ${result.invite.email}.`
          : "Invitation created. Share the link below; its email couldn't be queued."
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to create invitation"
      );
    } finally {
      setInviting(false);
    }
  }

  function createInvite(event: FormEvent) {
    event.preventDefault();
    void issueInvite(
      inviteEmail.trim(),
      inviteRole,
      inviteRole === "MEMBER" ? inviteMailboxIds : []
    );
  }

  async function revokeInvite(invite: OrganizationInvite) {
    try {
      await api.revokeInvite(invite.id);
      setCreatedInvite((current) =>
        current?.inviteId === invite.id ? null : current
      );
      await refreshTeam(invite.organizationId);
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
      await api.updateMemberRole(currentOrganizationId, member.userId, role);
      await refreshTeam(currentOrganizationId);
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
      await refreshTeam(currentOrganizationId);
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

  // Role options the current actor is allowed to assign (only an OWNER can
  // grant OWNER or ADMIN). The server re-checks regardless.
  const assignableRoles: InviteRole[] = isOwner
    ? ["OWNER", "ADMIN", "MEMBER"]
    : ["MEMBER"];

  function canEditMember(member: OrganizationMember) {
    // Admins manage members; only owners may change another admin.
    return !(actorRole === "ADMIN" && member.role !== "MEMBER");
  }

  function isLastOwner(member: OrganizationMember) {
    return member.role === "OWNER" && ownerCount <= 1;
  }

  if (!canManage) {
    return (
      <>
        <PageHeader
          title="Team"
          description="Members and invitations for this organization."
          breadcrumb={{ label: "Settings", to: "/settings" }}
        />
        <PageContainer>
          <EmptyState
            icon={Mail}
            title="Owners and admins only"
            description="Ask an owner of this organization to change your role if you need to manage the team."
          />
        </PageContainer>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Team"
        description="Who is in this organization, and what they can do."
        breadcrumb={{ label: "Settings", to: "/settings" }}
      />

      <PageContainer>
        <FormSections>
          <FormSection
            title="Invite a teammate"
            description="Invitations work even when public registration is closed, and expire after 7 days."
          >
            {createdInviteUrl ? (
              <CopyableSecret
                title="Invitation link"
                description={
                  createdInvite?.emailQueued
                    ? "The invitation email is queued. You can also share this link directly."
                    : "The invitation email could not be queued. Share this link directly or try resending."
                }
                value={createdInviteUrl}
                copiedMessage="Invite link copied."
                failureMessage="Unable to copy invite link."
              />
            ) : null}

            <form onSubmit={createInvite} className="space-y-4">
              <div className="flex flex-col gap-3 xs:flex-row xs:items-end">
                <Field>
                  <Label htmlFor="invite-email">Invite by email</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    width="name"
                    placeholder="teammate@example.com"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                  />
                </Field>
                <Field>
                  <Label htmlFor="invite-role">Role</Label>
                  <Select
                    value={inviteRole}
                    onValueChange={(value) =>
                      setInviteRole(value as InviteRole)
                    }
                  >
                    <SelectTrigger
                      id="invite-role"
                      className="w-full xs:w-32"
                      width="full"
                    >
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
                </Field>
              </div>
              {inviteRole === "MEMBER" ? (
                <fieldset className="space-y-2" disabled={inviting}>
                  <legend className="text-body font-medium">
                    Assign mailboxes (optional)
                  </legend>
                  <p className="text-ui text-text-secondary">
                    They can read and send from these mailboxes as soon as they
                    accept.
                  </p>
                  {mailboxesQuery.isPending ? (
                    <p className="text-ui text-text-secondary">
                      Loading mailboxes…
                    </p>
                  ) : mailboxesQuery.isError ? (
                    <div role="alert" className="text-ui text-warn">
                      Couldn't load mailboxes. You can retry or invite without
                      assigning one.
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void mailboxesQuery.refetch()}
                      >
                        Retry mailboxes
                      </Button>
                    </div>
                  ) : mailboxes.length ? (
                    <div className="space-y-3 rounded-control border p-3">
                      {mailboxes.map((mailbox) => (
                        <label
                          key={mailbox.id}
                          htmlFor={`invite-mailbox-${mailbox.id}`}
                          className="flex min-h-touch cursor-pointer items-center gap-3 text-body"
                        >
                          <Checkbox
                            id={`invite-mailbox-${mailbox.id}`}
                            checked={inviteMailboxIds.includes(mailbox.id)}
                            onCheckedChange={(checked) =>
                              setInviteMailboxIds((ids) =>
                                checked
                                  ? [...ids, mailbox.id]
                                  : ids.filter((id) => id !== mailbox.id)
                              )
                            }
                          />
                          <span>{mailbox.fromEmail}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-ui text-text-secondary">
                      No mailboxes available. Connect a mailbox first, or invite
                      now and assign one later.
                    </p>
                  )}
                </fieldset>
              ) : (
                <p className="text-ui text-text-secondary">
                  Owners and admins start with access to all mailboxes. Owners
                  can remove an admin’s mailbox access after they join.
                </p>
              )}
              <Button
                type="submit"
                disabled={
                  inviting || !currentOrganizationId || !inviteEmail.trim()
                }
              >
                {inviting ? <Spinner /> : <Mail className="h-4 w-4" />}
                Invite
              </Button>
            </form>
          </FormSection>

          <FormSection
            title="Members"
            description="Owners and admins manage this organization. Members read and send with assigned accounts. Instance administration is a separate permission."
          >
            <p className="mb-4 text-ui text-text-secondary">
              You can also change mailbox access after your teammate joins. To
              do so,{" "}
              <Link className="underline" to="/settings/mailboxes">
                assign a mailbox
              </Link>{" "}
              in mailbox settings. Sign-in reset links recover a QQueue account;
              mailbox passwords are managed separately by your mail
              administrator.
            </p>
            {membersQuery.isError || invitesQuery.isError ? (
              <div role="alert" className="mb-4 text-ui text-warn">
                Couldn't refresh the team. Previously loaded people may still
                appear.
                <Button
                  variant="secondary"
                  onClick={() => void refreshTeam(currentOrganizationId!)}
                >
                  Try again
                </Button>
              </div>
            ) : null}
            {loading ? (
              <div className="flex items-center gap-2 text-ui text-text-secondary">
                <Spinner />
                Loading team
              </div>
            ) : (
              <ul className="border-t border-border">
                {members.map((member) => {
                  const isSelf = member.userId === user?.id;
                  const editable = canEditMember(member);
                  const lockedOwner = isLastOwner(member);

                  return (
                    <li
                      key={member.id}
                      className="flex min-h-touch items-center gap-3 border-b border-border py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-body font-medium text-text">
                          {member.user.name ?? member.user.email}
                          {isSelf ? (
                            <span className="ml-2 text-meta font-text text-text-tertiary">
                              (you)
                            </span>
                          ) : null}
                        </div>
                        {member.user.name ? (
                          <div className="truncate text-ui text-text-secondary">
                            {member.user.email}
                          </div>
                        ) : null}
                      </div>

                      {isOwner && !lockedOwner ? (
                        <Select
                          value={member.role}
                          disabled={savingRoleFor === member.userId}
                          onValueChange={(value) =>
                            void changeRole(member, value)
                          }
                        >
                          <SelectTrigger
                            className="w-28 shrink-0"
                            width="full"
                            aria-label={`Role for ${member.user.email}`}
                          >
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

                      <RowActions
                        rowLabel={member.user.email}
                        className="shrink-0"
                        actions={[
                          {
                            label: "Send sign-in reset link",
                            icon: KeyRound,
                            primary: true,
                            disabled: !editable || resetPassword.isPending,
                            onSelect: () =>
                              resetPassword.mutate(member.user.email),
                          },
                          {
                            label: `Remove ${member.user.email}`,
                            icon: Trash2,
                            primary: true,
                            destructive: true,
                            disabled: !editable || lockedOwner,
                            onSelect: () => setRemoveTarget(member),
                          },
                        ]}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </FormSection>

          <FormSection
            title="Pending invitations"
            description="People who have been invited but haven't accepted yet."
          >
            {invites.length === 0 ? (
              <EmptyState
                icon={Mail}
                title="No pending invitations"
                description="Invite a teammate by email above to add them to this organization."
              />
            ) : (
              <ul className="border-t border-border">
                {invites.map((invite) => (
                  <li
                    key={invite.id}
                    className="flex min-h-touch items-center gap-3 border-b border-border py-3"
                  >
                    <div className="min-w-0 flex-1 text-body text-text">
                      <p className="truncate">{invite.email}</p>
                      <p className="text-meta text-text-secondary">
                        {invite.smtpConnectionIds?.length
                          ? `Mailboxes: ${invite.smtpConnectionIds.map((id) => mailboxes.find((mailbox) => mailbox.id === id)?.fromEmail ?? "Unavailable mailbox").join(", ")}. `
                          : ""}
                        {new Date(invite.expiresAt).getTime() <= Date.now()
                          ? "Expired — resend to renew"
                          : `Expires ${new Date(invite.expiresAt).toLocaleDateString()}`}
                      </p>
                    </div>
                    <Badge variant={roleBadgeVariant(invite.role)}>
                      {titleCaseRole(invite.role)}
                    </Badge>
                    <RowActions
                      rowLabel={invite.email}
                      className="shrink-0"
                      actions={[
                        {
                          label: `Resend invitation to ${invite.email}`,
                          icon: RotateCw,
                          primary: true,
                          disabled:
                            inviting || (invite.role !== "MEMBER" && !isOwner),
                          onSelect: () =>
                            void issueInvite(
                              invite.email,
                              invite.role as InviteRole,
                              invite.smtpConnectionIds ?? []
                            ),
                        },
                        {
                          label: `Revoke invitation for ${invite.email}`,
                          icon: Trash2,
                          primary: true,
                          destructive: true,
                          onSelect: () => void revokeInvite(invite),
                        },
                      ]}
                    />
                  </li>
                ))}
              </ul>
            )}
          </FormSection>
        </FormSections>
      </PageContainer>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title="Remove member?"
        description={`${removeTarget?.user.email} will lose access to this organization. They can be invited back later.`}
        confirmLabel="Remove member"
        destructive
        loading={removing}
        onConfirm={() => void removeMember()}
      />
    </>
  );
}
