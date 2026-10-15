import type { EmailAttachment } from "./api.js";
import type { PendingDraftPayload, PendingUpload } from "./offline-drafts.js";
/** Compare the writing and files actually backed up/accepted, not a later render. */
export function draftWritingFingerprint(
  payload: PendingDraftPayload,
  attachments: EmailAttachment[] = [],
  pendingUploads: PendingUpload[] = []
) {
  return JSON.stringify([
    payload,
    attachments.map((file) => file.id).sort(),
    pendingUploads.map((file) => file.uploadId).sort(),
  ]);
}
