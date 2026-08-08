import { PageContainer } from "../../components/PageContainer.js";
import { FormEvent, useEffect, useState } from "react";
import { Mail, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../../components/PageHeader.js";
import { CopyableSecret } from "../../components/settings/CopyableSecret.js";
import {
  Field,
  FormSection,
  FormSections,
} from "../../components/settings/FormLayout.js";
import { Badge } from "../../components/ui/badge.js";
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

  // Role options the current actor is allowed to assign (only an OWNER can
  // grant OWNER). The server re-checks regardless.
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
                description="We emailed this link to the invitee. You can also share it directly."
                value={createdInviteUrl}
                copiedMessage="Invite link copied."
                failureMessage="Unable to copy invite link."
              />
            ) : null}

            <form
              onSubmit={createInvite}
              className="flex flex-col gap-3 xs:flex-row xs:items-end"
            >
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
                  onValueChange={(value) => setInviteRole(value as InviteRole)}
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
            description="Owners can do anything. Admins manage the team and sending. Members send with the accounts they've been granted."
          >
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

                      {editable && !lockedOwner ? (
                        <Select
                          value={member.role}
                          disabled={savingRoleFor === member.userId}
                          onValueChange={(value) => void changeRole(member, value)}
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
                    <div className="min-w-0 flex-1 truncate text-body text-text">
                      {invite.email}
                    </div>
                    <Badge variant={roleBadgeVariant(invite.role)}>
                      {titleCaseRole(invite.role)}
                    </Badge>
                    <RowActions
                      rowLabel={invite.email}
                      className="shrink-0"
                      actions={[
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
