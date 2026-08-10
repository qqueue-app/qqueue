import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Globe, Loader2, Minus } from "lucide-react";
import { PageContainer } from "../../components/PageContainer.js";
import { PageHeader } from "../../components/PageHeader.js";
import { InstallAppCard } from "../../components/InstallAppCard.js";
import {
  FormSection,
  FormSections,
} from "../../components/settings/FormLayout.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import { Spinner } from "../../components/ui/spinner.js";
import { SettingsRow, Switch } from "../../components/ui/switch.js";
import {
  api,
  type InboxNotifyDomainGroup,
  type InboxNotifyLevel,
} from "../../lib/api.js";
import { qk } from "../../lib/query-client.js";
import { useSession } from "../../lib/session-context.js";
import { useApiMutation, useOrgQuery } from "../../lib/use-api.js";
import {
  useInboxNotifyPreference,
  usePushNotifications,
} from "../../lib/use-push-notifications.js";
import { cn } from "../../lib/utils.js";

/**
 * Everything about being interrupted, on one page.
 *
 * It moved off /settings/account because the answer stopped fitting in a single
 * select. Once members hold individual mailboxes, "notify me about this org"
 * is the wrong grain — somebody who reads support@ and a quiet alias wants one
 * of them to buzz, and a page-worth of that does not belong wedged between
 * "Signed in as" and "Sign out".
 *
 * Three questions, narrowing:
 *
 *   1. Should this device ring at all? (browser permission, per install)
 *   2. Which mailboxes may ring it? (the list below, per person)
 *   3. Which mail within them? (all, or only what names you)
 *
 * Mailboxes are grouped by domain because that is how people describe these
 * addresses to each other — "everything on acme.test" — and because a domain
 * switch is the one control that keeps working as the org grows. Only the
 * mailboxes *you* were granted appear under a domain: switching acme.test on
 * covers the one address you hold, not the ten the domain has.
 */
export function NotificationSettings() {
  const { currentOrganizationId, currentOrganization } = useSession();
  const push = usePushNotifications();
  const notify = useInboxNotifyPreference();

  const settingsQuery = useOrgQuery(
    currentOrganizationId,
    qk.inboxNotifySettings(currentOrganizationId ?? ""),
    (id) => api.inboxNotifySettings(id)
  );

  /*
    The response is the whole tree, so it is written straight into the cache
    rather than invalidated. A domain switch rewrites the ticks beneath it, and
    a refetch round-trip would leave the stale ones on screen long enough to
    see them disagree with the switch that was just moved.
  */
  const queryClient = useQueryClient();
  const updateRule = useApiMutation(api.updateInboxNotifyRule, {
    errorMessage: "Couldn't save that notification setting.",
    onSuccess: (data) => {
      queryClient.setQueryData(
        qk.inboxNotifySettings(data.organizationId),
        data
      );
    },
  });

  const pushActionable = push.status === "on" || push.status === "off";
  const pushOn = push.status === "on";

  // The instance has push and this browser can do it. Everything below the
  // device toggle is worth showing whenever that holds — including when
  // permission is blocked *here*, because it governs every other device too.
  const pushConfigured =
    push.status === "on" || push.status === "off" || push.status === "blocked";

  const domains = settingsQuery.data?.domains ?? [];

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Which mailboxes may interrupt you, and on which devices."
        breadcrumb={{ label: "Settings", to: "/settings" }}
      />

      <PageContainer>
        <FormSections>
          <FormSection
            title="This device"
            description="Push registrations belong to one browser install, so turning this on at a desk does nothing for the phone in your pocket."
          >
            <InstallAppCard />

            {/* `loading` renders nothing: under ~300ms a spinner is worse than
                the wait it announces. */}
            {push.status === "loading" ? null : (
              <div className="border-t border-border">
                <SettingsRow
                  label="New mail alerts on this device"
                  description={
                    pushOn
                      ? "You'll get an alert when a reply arrives, even when QQueue is closed."
                      : (push.reason ??
                        "Get an alert when a reply lands in your inbox, even when QQueue is closed.")
                  }
                  htmlFor="push-notifications"
                >
                  {push.busy ? (
                    <Spinner />
                  ) : pushActionable ? (
                    <Switch
                      id="push-notifications"
                      checked={pushOn}
                      onCheckedChange={(checked) =>
                        void (checked ? push.enable() : push.disable())
                      }
                      aria-label="New mail alerts on this device"
                    />
                  ) : (
                    <span className="text-meta text-text-tertiary">
                      Unavailable
                    </span>
                  )}
                </SettingsRow>
              </div>
            )}
          </FormSection>

          {pushConfigured && currentOrganizationId ? (
            <>
              <FormSection
                title="Mailboxes"
                description={`The mailboxes you can read in ${currentOrganization?.name ?? "this organization"}. New ones start switched on, so being given a mailbox never means quietly missing its mail.`}
              >
                {settingsQuery.isPending ? null : domains.length === 0 ? (
                  <p className="text-body text-text-secondary">
                    You don't have any mailboxes yet. Once an owner or admin
                    gives you one, it shows up here.
                  </p>
                ) : (
                  <div className="border-t border-border">
                    {domains.map((group) => (
                      <DomainRow
                        key={group.domain}
                        group={group}
                        busy={updateRule.isPending}
                        onToggleDomain={(enabled) =>
                          updateRule.mutate({
                            organizationId: currentOrganizationId,
                            enabled,
                            target: { scope: "DOMAIN", domain: group.domain },
                          })
                        }
                        onToggleMailbox={(inboxAccountId, enabled) =>
                          updateRule.mutate({
                            organizationId: currentOrganizationId,
                            enabled,
                            target: { scope: "MAILBOX", inboxAccountId },
                          })
                        }
                      />
                    ))}
                  </div>
                )}
              </FormSection>

              {/*
                The second axis, and deliberately last: it only makes sense once
                you know which mailboxes are in play. Unlike the toggle at the
                top it is server state, so it follows you onto every device.
              */}
              {!notify.isPending && (
                <FormSection
                  title="Which mail"
                  description="Applies to every mailbox above, on every device you've turned alerts on for."
                >
                  <div className="border-t border-border">
                    <SettingsRow
                      label="Alert me about"
                      description="Shared mailboxes are addressed to the mailbox, not to you — on a support@ box, 'only mail addressed to me' notifies nobody."
                      htmlFor="inbox-notify-level"
                    >
                      <Select
                        value={notify.level}
                        onValueChange={(value) =>
                          void notify.setLevel(value as InboxNotifyLevel)
                        }
                        disabled={notify.saving}
                      >
                        <SelectTrigger id="inbox-notify-level" width="choice">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ALL">All new mail</SelectItem>
                          <SelectItem value="ADDRESSED_TO_ME">
                            Only mail addressed to me
                          </SelectItem>
                          <SelectItem value="NONE">Nothing</SelectItem>
                        </SelectContent>
                      </Select>
                    </SettingsRow>
                  </div>
                </FormSection>
              )}
            </>
          ) : null}
        </FormSections>
      </PageContainer>
    </>
  );
}

interface DomainRowProps {
  group: InboxNotifyDomainGroup;
  busy: boolean;
  onToggleDomain: (enabled: boolean) => void;
  onToggleMailbox: (inboxAccountId: string, enabled: boolean) => void;
}

/**
 * One domain, collapsed to a single line until you want the detail.
 *
 * Collapsed is the default because the domain answer is the one most people
 * want: "everything on acme.test" is a sentence somebody says, "support@ yes,
 * billing@ no, sales@ yes" is not. Expanding is for the minority who mean the
 * second, and the count on the row is what tells them they need to.
 *
 * The domain control is a tri-state tick rather than a switch. A switch has two
 * positions and this has three — a domain with one mailbox muted underneath is
 * honestly neither on nor off, and drawing it as "off" is the small lie that
 * makes people stop believing the page.
 */
function DomainRow({
  group,
  busy,
  onToggleDomain,
  onToggleMailbox,
}: DomainRowProps) {
  const [open, setOpen] = useState(false);
  const enabledCount = group.mailboxes.filter(
    (mailbox) => mailbox.enabled
  ).length;

  // Select-all semantics: anything short of everything means "turn it all on".
  const next = group.state !== "ALL";
  const panelId = `notify-domain-${group.domain.replace(/[^a-z0-9]/gi, "-")}`;

  return (
    <section className="border-b border-border last:border-0">
      <div className="flex items-center gap-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex min-h-touch min-w-0 flex-1 items-center gap-2 rounded-control px-1 text-left transition-colors duration-fast ease-out hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "h-4 w-4 shrink-0 text-text-tertiary transition-transform duration-fast ease-out",
              open && "rotate-90"
            )}
          />
          <Globe aria-hidden className="h-4 w-4 shrink-0 text-text-tertiary" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-medium text-text">
              {group.domain}
            </span>
            <span className="block text-meta tabular-nums text-text-tertiary">
              {group.state === "ALL"
                ? `All ${group.mailboxes.length} notifying`
                : group.state === "NONE"
                  ? "Muted"
                  : `${enabledCount} of ${group.mailboxes.length} notifying`}
            </span>
          </span>
        </button>

        <TickButton
          state={group.state}
          busy={busy}
          label={
            next
              ? `Turn on notifications for every mailbox you have on ${group.domain}`
              : `Mute every mailbox you have on ${group.domain}`
          }
          onClick={() => onToggleDomain(next)}
        />
      </div>

      {/*
        The list is indented by 48px — the chevron, the globe, and their gaps —
        so an address lines up under the domain name it belongs to. At a
        smaller indent the children hang to the *left* of their parent's label,
        which reads as a flat list that happens to be nested.
      */}
      {open ? (
        <ul id={panelId} className="pb-2 pl-12">
          {group.mailboxes.map((mailbox) => (
            <li
              key={mailbox.inboxAccountId}
              className="flex items-center gap-3 border-t border-border py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-text">
                  {mailbox.email}
                </span>
                {mailbox.name && mailbox.name !== mailbox.email ? (
                  <span className="block truncate text-meta text-text-tertiary">
                    {mailbox.name}
                  </span>
                ) : null}
              </span>
              <TickButton
                state={mailbox.enabled ? "ALL" : "NONE"}
                busy={busy}
                label={
                  mailbox.enabled
                    ? `Mute ${mailbox.email}`
                    : `Turn on notifications for ${mailbox.email}`
                }
                onClick={() =>
                  onToggleMailbox(mailbox.inboxAccountId, !mailbox.enabled)
                }
              />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * A checkbox that can also say "partly" — the same square used by the mailbox
 * access editor, so ticking a mailbox means the same thing on both screens.
 */
function TickButton({
  state,
  busy,
  label,
  onClick,
}: {
  state: "ALL" | "NONE" | "SOME";
  busy: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === "ALL" ? true : state === "NONE" ? false : "mixed"}
      aria-label={label}
      disabled={busy}
      onClick={onClick}
      className="flex h-touch w-touch shrink-0 items-center justify-center rounded-control transition-colors duration-fast ease-out hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      <span
        aria-hidden
        className={cn(
          "flex h-5 w-5 items-center justify-center rounded-control border transition-colors duration-fast ease-out",
          state === "NONE"
            ? "border-border-strong bg-surface"
            : "border-primary bg-primary text-primary-foreground"
        )}
      >
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : state === "ALL" ? (
          <Check className="h-3.5 w-3.5" />
        ) : state === "SOME" ? (
          <Minus className="h-3.5 w-3.5" />
        ) : null}
      </span>
    </button>
  );
}
