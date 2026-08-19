import type { SentEmail } from "./api.js";

/*
  Vocabulary shared by the sent archive and the message reader.

  It lives here rather than in Sent.tsx because the reader is its own lazy
  chunk: importing these from the list page would pull the whole grid, its
  filters and TanStack Table into the bundle you download to read one email.
*/

export const ORIGIN_LABEL: Record<SentEmail["origin"], string> = {
  MANUAL: "Written by you",
  CAMPAIGN: "Campaign",
  TRANSACTIONAL: "App or API",
  SYSTEM: "Account email"
};

export interface SentOutcome {
  label: string;
  variant: "ok" | "err" | "warn" | "neutral" | "accent";
}

/**
 * What happened to one email, as a single badge.
 *
 * The pipeline records events rather than a state machine, so a message can be
 * delivered *and* opened *and* clicked at once. This picks the furthest thing
 * that happened — the worst news first, then the strongest engagement — because
 * a row has one line to say it and "Bounced" matters more than "Delivered".
 */
export function outcomeOf(email: SentEmail): SentOutcome {
  if (email.status === "FAILED") return { label: "Failed", variant: "err" };
  if (email.complained) return { label: "Marked as spam", variant: "err" };
  if (email.bounced) return { label: "Bounced", variant: "err" };
  if (email.clicks > 0) return { label: "Clicked", variant: "ok" };
  if (email.opens > 0) return { label: "Opened", variant: "ok" };
  if (email.delivered) return { label: "Delivered", variant: "ok" };
  // Handed to the mail server, with no delivery confirmation back yet. Not a
  // problem — most SMTP paths never send one.
  return { label: "Sent", variant: "neutral" };
}

export function engagementLabel(email: SentEmail) {
  if (email.opens === 0 && email.clicks === 0) return null;
  const parts = [];
  if (email.opens > 0) {
    parts.push(`${email.opens} ${email.opens === 1 ? "open" : "opens"}`);
  }
  if (email.clicks > 0) {
    parts.push(`${email.clicks} ${email.clicks === 1 ? "click" : "clicks"}`);
  }
  return parts.join(" · ");
}

export function sendingAccountLabel(email: SentEmail) {
  if (!email.sendingAccount) return "Account removed";
  return email.sendingAccount.fromName
    ? `${email.sendingAccount.fromName} <${email.sendingAccount.fromEmail}>`
    : email.sendingAccount.fromEmail;
}
