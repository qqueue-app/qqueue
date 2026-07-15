import type { SMTPConnectionFormValues } from "../components/SMTPConnectionForm.js";

const draftKey = "qqueue.setup-draft";

/**
 * In-progress /setup wizard state, persisted per-tab so a refresh or
 * navigation doesn't lose typed fields. Passwords are structurally excluded —
 * they must never touch web storage. Server state always wins over the draft:
 * the wizard only honors `step` when it's consistent with /setup/status.
 */
export interface SetupDraft {
  step?: "account" | "smtp" | "policy" | "test-email";
  account?: { email: string; name: string; organizationName: string };
  smtp?: Omit<SMTPConnectionFormValues, "password" | "isDefault">;
  allowPublicRegistration?: boolean;
}

// Private browsing or strict storage settings can make any sessionStorage
// access throw, so every touch is guarded — a lost draft is never an error.
export function getSetupDraft(): SetupDraft {
  try {
    const raw = window.sessionStorage.getItem(draftKey);
    return raw ? (JSON.parse(raw) as SetupDraft) : {};
  } catch {
    return {};
  }
}

export function saveSetupDraft(patch: Partial<SetupDraft>): void {
  try {
    // Sections set to undefined are dropped by JSON.stringify — that's how a
    // committed step deletes its portion of the draft.
    window.sessionStorage.setItem(
      draftKey,
      JSON.stringify({ ...getSetupDraft(), ...patch })
    );
  } catch {
    // Draft persistence is best-effort.
  }
}

export function clearSetupDraft(): void {
  try {
    window.sessionStorage.removeItem(draftKey);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
