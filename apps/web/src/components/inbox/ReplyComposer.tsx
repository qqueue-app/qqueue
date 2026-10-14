import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Paperclip, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { BodyEditor } from "../editor/BodyEditor.js";
import { Button } from "../ui/button.js";
import { IconButton } from "../ui/icon-button.js";
import { Spinner } from "../ui/spinner.js";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet.js";
import {
  api,
  type EmailAttachment,
  type InboundMessage,
} from "../../lib/api.js";
import { formatBytes } from "../../lib/format.js";
import { qk } from "../../lib/query-client.js";
import { useApiMutation, useOrgQuery } from "../../lib/use-api.js";
import { useSession } from "../../lib/session-context.js";
import { getSession } from "../../lib/session.js";

interface Props {
  message: InboundMessage;
  organizationId: string;
  mailboxEmail: string;
  initialDraftId?: string;
  onClose: () => void;
  onQueued: (id: string) => void;
}

interface ReplyBackup {
  html: string;
  attachments: EmailAttachment[];
  draftId?: string;
  replyAll: boolean;
  revision?: number;
  clientId?: string;
}

export function ReplyComposer({
  message,
  organizationId,
  mailboxEmail,
  initialDraftId,
  onClose,
  onQueued,
}: Props) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const storageKey = user?.id
    ? `qqueue.reply.${user.id}.${organizationId}.${message.id}`
    : null;
  const [backup] = useState<ReplyBackup | null>(() => {
    try {
      return storageKey
        ? JSON.parse(localStorage.getItem(storageKey) ?? "null")
        : null;
    } catch {
      return null;
    }
  });
  const [html, setHtml] = useState(backup?.html ?? "");
  const [attachments, setAttachments] = useState<EmailAttachment[]>(
    backup?.attachments ?? []
  );
  const [replyAll, setReplyAll] = useState(backup?.replyAll ?? false);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(Boolean(backup));
  const draftId = useRef(initialDraftId ?? backup?.draftId);
  const revision = useRef(backup?.revision ?? 1);
  const clientId = useRef(backup?.clientId ?? crypto.randomUUID());
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const touched = useRef(Boolean(backup));
  const sent = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const subject = /^re:/i.test(message.subject)
    ? message.subject
    : `Re: ${message.subject || "(no subject)"}`;

  const draftQuery = useOrgQuery(
    organizationId,
    ["reply-draft", organizationId, user?.id, message.id],
    async () => {
      if (draftId.current) return api.getEmailDraft(draftId.current);
      const drafts = await api.listEmailDrafts(organizationId);
      const existing = drafts.find(
        (draft) => draft.inboundMessageId === message.id
      );
      return existing ? api.getEmailDraft(existing.id) : null;
    }
  );
  useEffect(() => {
    const draft = draftQuery.data;
    if (!draft) return;
    draftId.current = draft.id;
    revision.current = draft.revision ?? 1;
    if (!touched.current) {
      setHtml(draft.html ?? "");
      setAttachments(draft.attachments ?? []);
      setReplyAll(Boolean(draft.variables?.qqueueReplyAll));
      setSaved(true);
    }
  }, [draftQuery.data]);

  const save = useApiMutation(
    async (body: string) => {
      const work = saveChain.current
        .catch(() => undefined)
        .then(async () => {
          if (user?.id && getSession().user?.id !== user.id)
            throw new Error(
              "Sign in to the original account to save this reply."
            );
          if (sent.current) return;
          const payload = {
            inboundMessageId: message.id,
            subject,
            html: body,
            to: message.replyTo?.length ? message.replyTo : [message.fromEmail],
            variables: { qqueueReplyAll: replyAll },
          };
          const draft = draftId.current
            ? await api.updateEmailDraft(draftId.current, {
                ...payload,
                expectedRevision: revision.current,
                mutationId: crypto.randomUUID(),
              })
            : await api.createEmailDraft({
                organizationId,
                clientId: clientId.current,
                ...payload,
              });
          draftId.current = draft.id;
          revision.current = draft.revision ?? 1;
          setSaved(true);
          return draft.id;
        });
      saveChain.current = work;
      return work;
    },
    {
      errorMessage:
        "Couldn't save to the server. Keep this reply open and try again.",
    }
  );

  useEffect(() => {
    if (!touched.current || sent.current) return;
    if (storageKey) {
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            html,
            attachments,
            replyAll,
            draftId: draftId.current,
            revision: revision.current,
            clientId: clientId.current,
          })
        );
      } catch {
        /* Server draft remains the primary copy. */
      }
    }
    if (draftQuery.isPending || draftQuery.isError) return;
    const timer = window.setTimeout(() => save.mutate(html), 1500);
    return () => window.clearTimeout(timer);
  }, [
    html,
    attachments,
    replyAll,
    storageKey,
    draftQuery.isPending,
    draftQuery.isError,
  ]);

  const send = useApiMutation(
    async () => {
      const savedDraftId = await save.mutateAsync(html);
      if (!savedDraftId) throw new Error("Save your reply before sending it.");
      const result = await api.replyToInboundMessage(message.id, {
        organizationId,
        subject,
        html,
        replyAll,
        idempotencyKey: savedDraftId,
        draftId: savedDraftId,
        expectedRevision: revision.current,
        attachmentIds: attachments.map((file) => file.id),
      });
      sent.current = true;
      try {
        if (storageKey) localStorage.removeItem(storageKey);
      } catch {
        /* The accepted send remains successful. */
      }

      return result;
    },
    {
      errorMessage: "Couldn't queue your reply. Your draft has been kept.",
      onSuccess: (result) => {
        void queryClient.invalidateQueries({
          queryKey: qk.drafts(organizationId),
        });
        toast.success(
          "Reply queued. You can follow its progress in this conversation or Outbox."
        );
        onQueued(result.id);
      },
    }
  );

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const emailDraftId = await save.mutateAsync(html);
      for (const file of Array.from(files)) {
        const uploaded = await api.uploadAttachment(file, {
          organizationId,
          emailDraftId,
        });
        touched.current = true;
        setAttachments((current) => [...current, uploaded]);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't attach this file."
      );
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const remove = useApiMutation(async (id: string) => {
    await api.deleteAttachment(id);
    setAttachments((current) => current.filter((file) => file.id !== id));
  });
  const recipient = message.replyTo?.length
    ? message.replyTo.join(", ")
    : message.fromEmail;
  const empty =
    !html
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim() && !/<img\b/i.test(html);
  function close() {
    if (send.isPending || uploading) return;
    if (touched.current && !draftQuery.isPending && !draftQuery.isError)
      save.mutate(html);
    onClose();
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!empty && !uploading && !send.isPending) send.mutate();
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <SheetContent side="right" className="w-full max-w-none sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>
            Reply to {message.fromName || message.fromEmail}
          </SheetTitle>
          <SheetDescription>{subject}</SheetDescription>
        </SheetHeader>
        <SheetBody>
          <form id="message-reply-form" onSubmit={submit} className="space-y-4">
            <p className="break-words text-ui">
              <strong>From:</strong> {mailboxEmail}
            </p>
            <p className="break-words text-ui">
              <strong>To:</strong> {recipient}
            </p>
            {message.to.length + message.cc.length > 1 ? (
              <label className="flex items-center gap-2 text-ui">
                <input
                  type="checkbox"
                  checked={replyAll}
                  onChange={(event) => {
                    touched.current = true;
                    setReplyAll(event.target.checked);
                  }}
                />{" "}
                Reply to everyone
              </label>
            ) : null}
            {replyAll ? (
              <p className="break-words text-meta text-text-secondary">
                Also includes the original To and Cc recipients, excluding this
                mailbox:{" "}
                {[...message.to, ...message.cc]
                  .filter(
                    (email) =>
                      email.toLowerCase() !== mailboxEmail.toLowerCase()
                  )
                  .join(", ")}
              </p>
            ) : null}
            <BodyEditor
              disabled={send.isPending}
              value={html}
              onChange={(value) => {
                touched.current = true;
                setSaved(false);
                setHtml(value);
              }}
              placeholder="Write your reply…"
              ariaLabel={`Reply to ${message.fromName || message.fromEmail}`}
              allowSource={false}
              showVariables={false}
              onUploadImage={async (file) =>
                (await api.uploadImage(file, { organizationId })).url
              }
            />
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              aria-label="Attach files to reply"
              onChange={(event) => void upload(event.target.files)}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={
                uploading ||
                send.isPending ||
                draftQuery.isPending ||
                draftQuery.isError
              }
              onClick={() => fileInput.current?.click()}
            >
              {uploading ? <Spinner /> : <Paperclip />} Attach files
            </Button>
            <ul className="space-y-2">
              {attachments.map((file) => (
                <li key={file.id} className="flex items-center gap-2 text-ui">
                  <span className="min-w-0 flex-1 truncate">
                    {file.filename} · {formatBytes(file.size)}
                  </span>
                  <IconButton
                    label={`Remove ${file.filename}`}
                    disabled={send.isPending || remove.isPending}
                    onClick={() => remove.mutate(file.id)}
                  >
                    <Trash2 />
                  </IconButton>
                </li>
              ))}
            </ul>
            {draftQuery.isError ? (
              <p role="alert" className="text-ui text-err">
                Couldn't load your saved reply.{" "}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void draftQuery.refetch()}
                >
                  Try again
                </Button>
              </p>
            ) : null}
            <p className="text-meta text-text-secondary" role="status">
              {save.isError
                ? "Couldn't save to the server. Your reply is kept on this device when browser storage is available."
                : saved
                  ? "Draft saved"
                  : "Changes will be saved automatically"}
            </p>
          </form>
        </SheetBody>
        <SheetFooter className="flex-row items-center justify-between">
          <Button
            type="button"
            variant="secondary"
            disabled={send.isPending || uploading}
            onClick={close}
          >
            Close and keep draft
          </Button>
          <Button
            type="submit"
            form="message-reply-form"
            disabled={
              empty ||
              send.isPending ||
              uploading ||
              draftQuery.isPending ||
              draftQuery.isError
            }
          >
            {send.isPending ? <Spinner /> : <Send />} Send reply
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
