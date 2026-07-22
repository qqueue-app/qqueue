import { useEffect, useMemo, useState } from "react";
import { normalizeContentId } from "../components/InboundHtmlFrame.js";
import { api, type InboundMessage } from "./api.js";

/** messageId → (normalized Content-ID → blob: URL). */
export type InlineImageMap = Record<string, Record<string, string>>;

/**
 * Download the inline (`cid:`) image parts of the messages on screen and hand
 * back local blob URLs for them.
 *
 * The download route is authenticated, so the iframe can't fetch these itself —
 * it has no session and we deliberately keep inbound files off the public
 * images endpoint. Fetching here and handing over object URLs keeps the blobs
 * private while still letting embedded images render.
 *
 * Object URLs are revoked when the set of parts changes or the reader navigates
 * away; a failed fetch is swallowed, leaving that one image blank.
 */
export function useInboundInlineImages(
  messages: InboundMessage[],
  organizationId: string | null
): InlineImageMap {
  const [urls, setUrls] = useState<InlineImageMap>({});

  const parts = useMemo(
    () =>
      messages.flatMap((message) =>
        !message.html || !message.html.includes("cid:")
          ? []
          : (message.attachments ?? [])
              .filter((file) => file.isInline && file.contentId)
              .map((file) => ({
                messageId: message.id,
                attachmentId: file.id,
                contentId: file.contentId as string,
              }))
      ),
    [messages]
  );
  // Polling replaces the message objects wholesale, so depend on the identity
  // of the parts rather than the array — otherwise every refresh refetches
  // every inline image and churns object URLs under the iframe.
  const partsKey = parts
    .map((part) => `${part.messageId}:${part.attachmentId}`)
    .join(",");

  useEffect(() => {
    if (!organizationId || parts.length === 0) {
      setUrls({});
      return;
    }

    let cancelled = false;
    const created: string[] = [];

    void (async () => {
      const next: InlineImageMap = {};
      for (const part of parts) {
        try {
          const blob = await api.downloadInboundAttachment({
            messageId: part.messageId,
            attachmentId: part.attachmentId,
            organizationId,
          });
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          created.push(url);
          next[part.messageId] = {
            ...next[part.messageId],
            [normalizeContentId(part.contentId)]: url,
          };
        } catch {
          // Leave this image blank; the rest of the body still renders.
        }
      }
      if (!cancelled) setUrls(next);
    })();

    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
    // `parts` is intentionally read but not a dependency: partsKey stands in
    // for it, and its identity changes on every poll.
  }, [partsKey, organizationId]);

  return urls;
}
