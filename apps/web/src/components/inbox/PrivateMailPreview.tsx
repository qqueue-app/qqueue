import { useEffect, useMemo, useState } from "react";
import { InboundHtmlFrame, normalizeContentId } from "../InboundHtmlFrame.js";
import { api } from "../../lib/api.js";
import { useOrgQuery } from "../../lib/use-api.js";
import { qk } from "../../lib/query-client.js";
import { Button } from "../ui/button.js";

/** Display-only private URLs must never be written back into the draft HTML. */
export function PrivateMailPreview({
  html,
  files,
  organizationId,
  userId,
  version,
  receivedMessageId,
  title,
}: {
  html: string;
  files: Array<{ id: string; filename: string; cid?: string | null }>;
  organizationId: string;
  userId: string;
  version: string;
  receivedMessageId?: string;
  title: string;
}) {
  const parts = files.filter((file) => file.cid);
  const query = useOrgQuery(
    organizationId,
    qk.privateInlineParts(
      organizationId,
      userId,
      receivedMessageId ?? "personal",
      version,
      parts.map((file) => file.id)
    ),
    async () =>
      Promise.all(
        parts.map(async (file) => {
          try {
            const blob = receivedMessageId
              ? await api.downloadInboundAttachment({
                  organizationId,
                  messageId: receivedMessageId,
                  attachmentId: file.id,
                })
              : await api.downloadAttachment(file.id);
            return { cid: file.cid!, blob, filename: file.filename };
          } catch {
            return { cid: file.cid!, blob: null, filename: file.filename };
          }
        })
      ),
    { enabled: parts.length > 0 && /cid:/i.test(html), staleTime: 60_000 }
  );
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    const created: string[] = [];
    for (const part of query.data ?? [])
      if (part.blob) {
        const url = URL.createObjectURL(part.blob);
        created.push(url);
        next[normalizeContentId(part.cid)] = url;
      }
    setUrls(next);
    return () => created.forEach((url) => URL.revokeObjectURL(url));
  }, [query.data]);
  const failed = useMemo(
    () =>
      query.data?.filter((part) => !part.blob).map((part) => part.filename) ??
      [],
    [query.data]
  );
  return (
    <div className="space-y-2">
      {failed.length ? (
        <p role="alert">
          Some private images could not be previewed: {failed.join(", ")}.{" "}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            Retry images
          </Button>
        </p>
      ) : null}
      <InboundHtmlFrame
        html={html}
        inlineImages={urls}
        showRemoteContent={false}
        title={title}
      />
    </div>
  );
}
