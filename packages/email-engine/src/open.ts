/**
 * Open classification.
 *
 * An "open" is one fetch of the tracking pixel, and a fetch is not the same
 * thing as a person reading the mail. Three different things pull that URL:
 *
 *  - **A reader's mail client.** The signal we actually want.
 *  - **A caching image proxy** (Gmail's `GoogleImageProxy`, Yahoo's). These are
 *    fetched *because* a human displayed the message, so they are genuine opens
 *    wearing a proxy's User-Agent — deliberately NOT classified as automated.
 *    Marking them so would erase the opens of every Gmail recipient.
 *  - **Machines that never read anything**: security appliances that pre-fetch
 *    every URL in inbound mail, link-preview crawlers, and privacy proxies that
 *    fetch remote content on delivery so the sender learns nothing from timing.
 *
 * Only the third group is automated. It is identified by User-Agent where the
 * fetcher is honest enough to say so, and by timing where it isn't: Apple Mail
 * Privacy Protection presents an ordinary Mac Mail User-Agent, and the only
 * thing separating it from a person is that it fires seconds after the message
 * was handed to the mail server, before a human could plausibly have looked.
 *
 * Nothing here discards an event. Classification is an annotation on the stored
 * row so reporting can weigh it; the raw log stays complete.
 */

export type AutomatedOpenReason = "scanner" | "prefetch" | "no-user-agent";

export interface OpenClassification {
  automated: boolean;
  /** Why, when automated. Undefined for an open that looks like a person. */
  reason?: AutomatedOpenReason;
}

/**
 * An open landing within this many seconds of the send is treated as a machine
 * pre-fetch rather than a reader.
 *
 * The tradeoff is one-sided on purpose. In production a recipient has to
 * receive the message, notice it, and open it, which does not happen in fifteen
 * seconds; a privacy proxy fetching on delivery always does. The case this
 * misreads is sending a test to yourself and opening it immediately — annoying
 * while testing, harmless in reporting, and the stored `secondsSinceSent` says
 * exactly why the row was marked.
 */
export const AUTOMATED_OPEN_WINDOW_SECONDS = 15;

/*
  Security gateways, link/attachment scanners and privacy relays that fetch mail
  content without a person present. Anchored on vendor tokens rather than loose
  words so an ordinary client string can't trip them.
*/
const SCANNER_PATTERNS =
  /barracuda|proofpoint|mimecast|symantec|ironport|forcepoint|sophos|trend ?micro|fireeye|zscaler|safelinks|messagelabs|spamexperts|mailcontrol|cloudmark|fortinet|paloalto|checkpoint|opendns|urldefense|linkprotect|clicktime|virustotal/i;

/*
  Link-preview crawlers and generic bots. `preview` and `fetcher` sit here
  rather than in a broader word list because mail clients don't use either in a
  User-Agent, while every unfurler does.
*/
const CRAWLER_PATTERNS =
  /\bbot\b|bot\/|crawler|spider|slurp|facebookexternalhit|whatsapp|telegram|discord|slack-?imgproxy|linkedin|twitter|skypeuripreview|bingpreview|preview|fetcher|scanner|monitor|validator|headlesschrome|phantomjs|puppeteer|playwright/i;

/*
  Raw HTTP clients. A mail client never identifies as one, so a pixel fetched
  with curl or a language runtime's default agent is a script — replaying a
  forwarded tracking URL, or probing the endpoint.
*/
const HTTP_CLIENT_PATTERNS =
  /^curl\/|^wget\b|python-requests|python-urllib|aiohttp|go-http-client|^java\/|okhttp|axios|node-fetch|undici|libwww-perl|apache-httpclient|guzzle|postmanruntime|insomnia|httpie|restsharp|^lwp/i;

/**
 * Classify one pixel fetch. `secondsSinceSent` is null when the job has no
 * `sentAt` — a job that never recorded a send time can't be judged on timing,
 * so it is judged on User-Agent alone.
 */
export function classifyOpen(input: {
  userAgent?: string | null;
  secondsSinceSent?: number | null;
}): OpenClassification {
  const agent = input.userAgent?.trim();

  // No User-Agent at all. Every real mail client and image proxy sends one, so
  // this is a script — or a request built by hand.
  if (!agent) {
    return { automated: true, reason: "no-user-agent" };
  }

  if (
    SCANNER_PATTERNS.test(agent) ||
    CRAWLER_PATTERNS.test(agent) ||
    HTTP_CLIENT_PATTERNS.test(agent)
  ) {
    return { automated: true, reason: "scanner" };
  }

  const elapsed = input.secondsSinceSent;
  if (
    typeof elapsed === "number" &&
    elapsed >= 0 &&
    elapsed <= AUTOMATED_OPEN_WINDOW_SECONDS
  ) {
    return { automated: true, reason: "prefetch" };
  }

  return { automated: false };
}
