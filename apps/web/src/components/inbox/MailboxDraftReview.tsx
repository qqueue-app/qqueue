import type { MailboxDraftStatus } from "@qqueue/shared";
import { useRef, useState } from "react";
import { api, type EmailDraft } from "../../lib/api.js";
import { useApiMutation, useOrgQuery } from "../../lib/use-api.js";
import { qk } from "../../lib/query-client.js";
import { formatBytes } from "../../lib/format.js";
import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { PrivateMailPreview } from "./PrivateMailPreview.js";

export function MailboxDraftReview({
  organizationId,
  userId,
  draftId,
  onKeep,
  onOpen,
}: {
  organizationId: string;
  userId: string;
  draftId: string;
  onKeep: (version: string) => Promise<void>;
  onOpen: (draft: EmailDraft) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reviewed, setReviewed] = useState<MailboxDraftStatus>();
  const ids = useRef(new Map<string, string>());
  const status = useOrgQuery(
    organizationId,
    qk.mailboxDraftSource(organizationId, userId, draftId),
    () => api.getMailboxDraftSource(draftId),
    { refetchInterval: 15_000 }
  );
  const keep = useApiMutation(
    async () => {
      if (!reviewed)
        throw new Error("Load the original draft before choosing.");
      await onKeep(reviewed.currentVersion);
    },
    {
      onSuccess: () => {
        setOpen(false);
        void status.refetch();
      },
      onError: () => void status.refetch(),
    }
  );
  const latest = useApiMutation(
    async () => {
      const source = reviewed?.source;
      if (!source || reviewed?.state === "LOADING")
        throw new Error("The original draft is not available yet.");
      const version = reviewed!.currentVersion;
      let clientId = ids.current.get(version);
      if (!clientId) {
        clientId = crypto.randomUUID();
        ids.current.set(version, clientId);
      }
      const draft = await api.prepareMailboxDraftCopy(
        source.id,
        organizationId,
        clientId,
        version
      );
      await onOpen(draft);
    },
    { onSuccess: () => setOpen(false), onError: () => void status.refetch() }
  );
  return (
    <aside
      className="space-y-2 rounded-card bg-accent p-3 text-ui"
      aria-label="Mailbox draft copy"
    >
      <p className="font-medium">Private copy of a mailbox draft</p>
      <p>
        The original stays in the mailbox, including after sending this copy.
        Check other mail apps to avoid sending it twice.
      </p>
      <p role="status">
        {status.isError
          ? "Couldn’t check the original. Your private writing is kept."
          : !status.data
            ? "Checking the last synced original…"
            : status.data.state === "LOADING"
              ? "The original’s text and files are still loading. Sending waits until they are ready."
              : status.data.state === "UNAVAILABLE"
                ? "The original is no longer available as a mailbox draft. Review before sending your copy."
                : status.data.state === "UPDATED"
                  ? status.data.reviewed
                    ? "You chose to keep your copy after reviewing the changed original."
                    : "The original changed in another app. Review its latest text and files before sending your copy."
                  : "The original has not changed since this copy was prepared."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void status.refetch()}
          disabled={status.isFetching}
        >
          Check again
        </Button>
        {status.data ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setReviewed(status.data);
              setOpen(true);
            }}
          >
            Review mailbox draft
          </Button>
        ) : null}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review mailbox draft</DialogTitle>
            <DialogDescription>
              Your writing stays in the composer. Opening the latest original
              creates another private copy and preserves this writing first.
              Changes are checked against the last mailbox sync.
            </DialogDescription>
          </DialogHeader>
          {reviewed?.source ? (
            <div className="space-y-2">
              <p className="font-semibold">
                {reviewed.source.subject || "(no subject)"}
              </p>
              <p>To: {reviewed.source.to.join(", ") || "None"}</p>
              <p>Cc: {reviewed.source.cc.join(", ") || "None"}</p>
              <p>Bcc: {reviewed.source.bcc.join(", ") || "None"}</p>
              {reviewed.source.html ? (
                <PrivateMailPreview
                  html={reviewed.source.html}
                  files={reviewed.source.attachments}
                  organizationId={organizationId}
                  userId={userId}
                  version={reviewed.currentVersion}
                  receivedMessageId={reviewed.source.id}
                  title="Last synced mailbox draft"
                />
              ) : (
                <p className="whitespace-pre-wrap">
                  {reviewed.source.text || "No message text"}
                </p>
              )}
              <ul>
                {reviewed.source.attachments.map((file) => (
                  <li key={file.id}>
                    {file.filename} · {formatBytes(file.size)}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p>
              {reviewed?.state === "LOADING"
                ? "Wait for the original to finish loading, then check again."
                : "The original may have been sent, removed, moved, or become inaccessible. Your private copy is retained. Confirm its recipients and files before choosing to keep it."}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => keep.mutate()}
              disabled={
                !reviewed ||
                status.isError ||
                reviewed.state === "LOADING" ||
                keep.isPending ||
                latest.isPending
              }
            >
              Keep my private copy
            </Button>
            {reviewed?.source ? (
              <Button
                type="button"
                onClick={() => latest.mutate()}
                disabled={keep.isPending || latest.isPending || status.isError}
              >
                Open latest as another private copy
              </Button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
