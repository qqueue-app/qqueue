import type { InboxConversationWindowInput } from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";

export const CONVERSATION_BODY_PAGE_SIZE = 10;
/** Stable message identities bound to the authorized conversation, not offsets
 * that shift when a teammate sends a new reply. Metadata membership stays whole. */
export function selectConversationWindow(
  entries: { key: string; at: Date }[],
  anchor: string,
  input: InboxConversationWindowInput
) {
  const ordered = [...entries].sort(
    (a, b) => a.at.getTime() - b.at.getTime() || a.key.localeCompare(b.key)
  );
  const boundary = input.before ?? input.after;
  const index = boundary
    ? ordered.findIndex((entry) => entry.key === boundary)
    : -1;
  if (boundary && index < 0)
    throw new HttpError(
      400,
      "This conversation page is unavailable. Return to the original message to reload it."
    );
  const size = CONVERSATION_BODY_PAGE_SIZE;
  let start: number;
  if (input.before) start = Math.max(0, index - size);
  else if (input.after) start = index + 1;
  else {
    const selected = ordered.findIndex((entry) => entry.key === anchor);
    start = Math.max(
      0,
      Math.min(selected < 0 ? ordered.length : selected + 1, ordered.length) -
        size
    );
  }
  const end = input.before ? index : Math.min(ordered.length, start + size);
  const page = ordered.slice(start, end);
  return {
    keys: page.map((entry) => entry.key),
    before: start > 0 ? (page[0]?.key ?? null) : null,
    after: end < ordered.length ? (page.at(-1)?.key ?? null) : null,
    total: ordered.length,
    start: start + 1,
    end,
  };
}
