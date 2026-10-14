import {
  useReadingPreference,
  setReadingPreference,
} from "../../lib/reading-preference.js";
import { PageContainer } from "../../components/PageContainer.js";
import { LogOut } from "lucide-react";
import { PageHeader } from "../../components/PageHeader.js";
import {
  FormSection,
  FormSections,
} from "../../components/settings/FormLayout.js";
import { SettingsLinkRow } from "../../components/settings/SettingsLinkRow.js";
import { Button } from "../../components/ui/button.js";
import { useSession } from "../../lib/session-context.js";

/**
 * Everything scoped to *you* rather than to the organization: who you are
 * signed in as, and signing out.
 *
 * Its own page, and deliberately not reachable through the Organization one.
 * On the old settings screen "Sign out" sat in a two-column grid next to
 * "Rename organization", which made a personal action read as an
 * administrative one — §6's eighth anti-pattern, and the mix-up most likely to
 * make somebody hesitate before clicking.
 *
 * Notifications used to live here too, as a device toggle and one select. They
 * moved to /settings/notifications once the answer grew a mailbox list: a page
 * of alert preferences wedged between "Signed in as" and "Sign out" buries the
 * question people actually arrive with. The link below stays because this is
 * still where somebody looks for it first.
 */
export function AccountSettings() {
  const { user, signOut: clearSessionState } = useSession();

  const reading = useReadingPreference(user?.id ?? "signed-out");

  function signOut() {
    clearSessionState();
    // A full navigation rather than a router push: it drops the in-memory query
    // cache along with the session, so the next person to sign in on this
    // browser cannot be handed the previous one's inbox out of cache.
    window.location.href = "/login";
  }

  return (
    <>
      <PageHeader
        title="Account"
        description="Your sign-in, and signing out."
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
            </dl>
          </FormSection>

          <FormSection
            title="Appearance"
            description="A preference for this account on this device. Phones always open one conversation at a time."
          >
            <fieldset className="space-y-3">
              <legend className="text-ui font-medium">Reading layout</legend>
              <label className="flex min-h-touch items-center gap-3 text-ui">
                <input
                  type="radio"
                  name="reading-layout"
                  checked={reading === "pane"}
                  onChange={() =>
                    setReadingPreference(user?.id ?? "signed-out", "pane")
                  }
                />
                Reading pane — list and message side by side
              </label>
              <label className="flex min-h-touch items-center gap-3 text-ui">
                <input
                  type="radio"
                  name="reading-layout"
                  checked={reading === "focused"}
                  onChange={() =>
                    setReadingPreference(user?.id ?? "signed-out", "focused")
                  }
                />
                Focused mail — one screen at a time
              </label>
            </fieldset>
          </FormSection>

          <FormSection title="Notifications">
            <ul className="border-t border-border">
              <SettingsLinkRow
                to="/settings/notifications"
                title="Notifications"
                description="Which mailboxes may interrupt you, and on which devices."
              />
            </ul>
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
