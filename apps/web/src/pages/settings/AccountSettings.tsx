import { PageContainer } from "../../components/PageContainer.js";
import { LogOut } from "lucide-react";
import { PageHeader } from "../../components/PageHeader.js";
import { InstallAppCard } from "../../components/InstallAppCard.js";
import {
  FormSection,
  FormSections,
} from "../../components/settings/FormLayout.js";
import { Button } from "../../components/ui/button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import { Spinner } from "../../components/ui/spinner.js";
import { SettingsRow, Switch } from "../../components/ui/switch.js";
import { apiBaseUrl, type InboxNotifyLevel } from "../../lib/api.js";
import { useSession } from "../../lib/session-context.js";
import {
  useInboxNotifyPreference,
  usePushNotifications,
} from "../../lib/use-push-notifications.js";

/**
 * Everything scoped to *you* rather than to the organization: who you are
 * signed in as, alerts on this device, and signing out.
 *
 * Its own page, and deliberately not reachable through the Organization one.
 * On the old settings screen "Sign out" sat in a two-column grid next to
 * "Rename organization", which made a personal action read as an
 * administrative one — §6's eighth anti-pattern, and the mix-up most likely to
 * make somebody hesitate before clicking.
 */
export function AccountSettings() {
  const { user, currentOrganization, signOut: clearSessionState } = useSession();
  const push = usePushNotifications();
  const notify = useInboxNotifyPreference();

  function signOut() {
    clearSessionState();
    // A full navigation rather than a router push: it drops the in-memory query
    // cache along with the session, so the next person to sign in on this
    // browser cannot be handed the previous one's inbox out of cache.
    window.location.href = "/login";
  }

  const pushActionable = push.status === "on" || push.status === "off";
  const pushOn = push.status === "on";

  // The instance has push and this browser can do it. The preference below is
  // worth showing whenever that holds — including when permission is blocked
  // *here*, because it governs every other device the person owns too.
  const pushConfigured =
    push.status === "on" || push.status === "off" || push.status === "blocked";

  return (
    <>
      <PageHeader
        title="Account"
        description="Your sign-in, alerts on this device, and signing out."
        breadcrumb={{ label: "Settings", to: "/settings" }}
      />

      <PageContainer>
        <FormSections>
          <FormSection title="Signed in as">
            <dl className="border-t border-border">
              <div className="flex items-center justify-between gap-4 border-b border-border py-3">
                <dt className="text-ui text-text">Email</dt>
                <dd className="min-w-0 break-all text-right text-ui text-text-secondary">
                  {user?.email ?? "Not signed in"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 border-b border-border py-3">
                <dt className="text-ui text-text">API base URL</dt>
                <dd className="min-w-0 break-all text-right font-mono text-meta text-text-secondary">
                  {apiBaseUrl || window.location.origin}
                </dd>
              </div>
            </dl>
          </FormSection>

          <FormSection
            title="Notifications"
            description="Push subscriptions belong to one browser install, so turning this on at a desk does nothing for the phone in your pocket."
          >
            <InstallAppCard />

            {/*
              A settings row, not the icon-tiled card this used to be: the bell
              glyph beside a control labelled "New mail alerts" repeated the
              label in pictures (§6, anti-pattern 6).

              `loading` renders nothing at all — under ~300ms a spinner is worse
              than the wait it announces.
            */}
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

                {/*
                  Which mail, as opposed to which device. This one is server
                  state and follows the person onto every device they own, so it
                  reads as a sibling of the toggle rather than something nested
                  under it — the toggle answers "here?", this answers "about
                  what?".
                */}
                {pushConfigured && currentOrganization && !notify.isPending && (
                  <SettingsRow
                    label={`Mail from ${currentOrganization.name}`}
                    description="Applies to every device you've turned alerts on for, not just this one."
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
                )}
              </div>
            )}
          </FormSection>

          <FormSection
            title="Session"
            description="Signs you out of this browser only. Other devices stay signed in."
          >
            <Button type="button" variant="secondary" onClick={signOut}>
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </FormSection>
        </FormSections>
      </PageContainer>
    </>
  );
}
