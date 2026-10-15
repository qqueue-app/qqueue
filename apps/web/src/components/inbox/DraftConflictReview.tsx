import { useState } from "react";
import { api, type EmailDraft } from "../../lib/api.js";
import { useApiMutation } from "../../lib/use-api.js";
import { Button } from "../ui/button.js";
import { EmailPreviewFrame } from "../EmailPreviewFrame.js";

function snapshot(draft: EmailDraft) {
  return JSON.stringify([
    draft.revision,
    draft.html,
    draft.subject,
    draft.to,
    draft.cc,
    draft.bcc,
    draft.replyTo,
    draft.smtpConnectionId,
    draft.variables,
    (draft.attachments ?? []).map((file) => file.id).sort(),
  ]);
}
export function DraftConflictReview({
  organizationId,
  draftId,
  clientId,
  onUse,
  onAccepted,
  onKeep,
}: {
  organizationId: string;
  draftId?: string | null;
  clientId?: string;
  onUse: (draft: EmailDraft) => void | Promise<void>;
  onKeep?: (draft: EmailDraft) => void | Promise<void>;
  onAccepted: (id: string) => void;
}) {
  const [compared, setCompared] = useState<EmailDraft>();
  async function load() {
    const id =
      draftId ??
      (await api.listEmailDrafts(organizationId)).find(
        (draft) => draft.clientId === clientId
      )?.id;
    if (!id)
      throw new Error(
        "Couldn't find the saved version. Keep this composer open and check Drafts or Outbox."
      );
    const draft = await api.getEmailDraft(id);
    if (draft.organizationId !== organizationId)
      throw new Error(
        "Switch back to the original organization before reviewing this draft."
      );
    return draft;
  }
  const compare = useApiMutation(load, {
    onSuccess: (draft) => {
      if (draft.completedSendId) onAccepted(draft.completedSendId);
      else setCompared(draft);
    },
    errorMessage: "Couldn't load the saved version. Your writing is kept here.",
  });
  const choose = useApiMutation(async (choice: "saved" | "local") => {
    const current = await load();
    if (current.completedSendId) {
      onAccepted(current.completedSendId);
      return;
    }
    if (!compared || snapshot(current) !== snapshot(compared)) {
      setCompared(current);
      throw new Error(
        "The saved draft changed again. Review its latest version before replacing your writing."
      );
    }
    if (choice === "local") await onKeep?.(current);
    else await onUse(current);
    setCompared(undefined);
  });
  return (
    <div className="space-y-3 text-ui">
      <p role="alert">
        This draft changed on another device or was already sent. Your version
        is kept here. Compare the saved version before sending.
      </p>
      <Button
        type="button"
        variant="secondary"
        disabled={compare.isPending || choose.isPending}
        onClick={() => compare.mutate()}
      >
        Compare saved version
      </Button>
      {compared ? (
        <div className="space-y-2 rounded-control border p-3">
          <p className="font-medium">Saved version (read only)</p>
          <p>Subject: {compared.subject}</p>
          <p className="break-words">To: {compared.to?.join(", ")}</p>
          {compared.cc?.length ? <p>Cc: {compared.cc.join(", ")}</p> : null}
          {compared.bcc?.length ? <p>Bcc: {compared.bcc.join(", ")}</p> : null}
          <EmailPreviewFrame
            title="Saved draft version"
            html={compared.html ?? ""}
          />
          {(compared.attachments ?? []).map((file) => (
            <p key={file.id}>{file.filename}</p>
          ))}
          <p>
            Use the saved version to replace this composer; your current writing
            and waiting files are kept as a separate recovery copy. Keep my
            writing retains your current text and recipients and both sets of
            uploaded files. It saves against the reviewed version; another
            concurrent change will require comparison again.
          </p>
          {onKeep ? (
            <Button
              type="button"
              disabled={compare.isPending || choose.isPending}
              onClick={() => choose.mutate("local")}
            >
              Keep my writing
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            disabled={compare.isPending || choose.isPending}
            onClick={() => choose.mutate("saved")}
          >
            Use saved version
          </Button>
        </div>
      ) : null}
    </div>
  );
}
