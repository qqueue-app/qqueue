import { useEffect, useState } from "react";
import { Download, Share, Smartphone, X } from "lucide-react";
import { Button } from "./ui/button.js";
import { IconButton } from "./ui/icon-button.js";
import { isIos, isStandalone } from "../lib/push.js";

/**
 * Chrome/Edge fire this instead of showing their own install UI once the page
 * meets the installability criteria, letting us place the prompt where it makes
 * sense. It is not in TypeScript's DOM lib.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "qqueue.install-prompt-dismissed";

/**
 * Invitation to install QQueue as an app. Two very different paths: Chromium
 * browsers hand us a real install prompt, while iOS has no API at all and the
 * only honest thing to do is describe the Share-sheet steps — which matters
 * because on iOS installing is also the *only* way to get notifications.
 */
export function InstallAppCard() {
  const [promptEvent, setPromptEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(DISMISSED_KEY) === "true";
    } catch {
      return false;
    }
  });

  /*
    Installed-ness is watched, not sampled.

    §5 rules out showing an install prompt inside an installed app, and reading
    it once at render is not enough to guarantee that: accepting the prompt
    doesn't reload the page, so the card would sit there inviting someone to
    install an app they are already using. `appinstalled` and the display-mode
    query between them cover both routes in — installing from this card, and
    installing from the browser's own menu.
  */
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setInstalled(true);
      setPromptEvent(null);
    }

    const displayMode = window.matchMedia("(display-mode: standalone)");
    const onDisplayModeChange = () => setInstalled(isStandalone());

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    displayMode.addEventListener("change", onDisplayModeChange);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      displayMode.removeEventListener("change", onDisplayModeChange);
    };
  }, []);

  const ios = isIos();

  // Nothing to say once it's installed, once it's been waved away, or on a
  // browser that offers no install path at all.
  if (installed || dismissed || (!promptEvent && !ios)) {
    return null;
  }

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // Private browsing blocks localStorage; the prompt simply returns later.
    }
  }

  async function install() {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    setPromptEvent(null);
    if (outcome === "accepted") dismiss();
  }

  return (
    <div className="relative flex flex-col gap-3 rounded-card border border-border bg-accent p-4 xs:flex-row xs:items-center">
      <Smartphone
        className="h-5 w-5 shrink-0 text-primary"
        aria-hidden
      />
      <div className="min-w-0 flex-1 pr-8">
        <p className="text-body font-medium text-text">Install QQueue</p>
        {ios ? (
          <p className="mt-1 text-ui leading-5 text-text-secondary">
            Tap <Share className="inline h-3.5 w-3.5 align-text-bottom" /> Share,
            then <strong className="font-medium">Add to Home Screen</strong>. On
            iPhone and iPad this is also what unlocks notifications for new mail.
          </p>
        ) : (
          <p className="mt-1 text-ui leading-5 text-text-secondary">
            Get a full-screen app with notifications for new mail.
          </p>
        )}
      </div>
      {promptEvent ? (
        <Button variant="secondary" onClick={install} className="shrink-0">
          <Download className="h-4 w-4" />
          Install
        </Button>
      ) : null}
      <IconButton
        label="Dismiss install prompt"
        size="sm"
        onClick={dismiss}
        className="absolute right-2 top-2"
      >
        <X />
      </IconButton>
    </div>
  );
}
