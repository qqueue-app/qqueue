import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Paperclip, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  SignatureControl,
  signatureStamp,
  type SignatureStamp,
} from "./SignatureControl.js";
import { RecipientField } from "./RecipientField.js";
import {
  savePendingDraft,
  acknowledgePendingDraft,
  listPendingDrafts,
  deletePendingDraft,
  type PendingUpload,
  type PendingDraft,
} from "../../lib/offline-drafts.js";
import { BodyEditor } from "../editor/BodyEditor.js";
import { DraftConflictReview } from "./DraftConflictReview.js";
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
  to?: string[];
  cc?: string[];
  bcc?: string[];
  recipientInputs?: Record<string, string>;
  signature?: SignatureStamp;
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
    ? `qqueue.reply.${user.id}.${organizationId}.${message.id}${initialDraftId ? `.${initialDraftId}` : ""}`
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
  const [signature, setSignature] = useState<SignatureStamp | undefined>(() =>
    signatureStamp(backup?.signature)
  );
  const [html, setHtml] = useState(backup?.html ?? "");
  const [attachments, setAttachments] = useState<EmailAttachment[]>(
    backup?.attachments ?? []
  );
  const [replyAll, setReplyAll] = useState(backup?.replyAll ?? false);
  const defaultTo = message.replyTo?.length
    ? message.replyTo
    : [message.fromEmail];
  function resolvedRecipients(all: boolean) {
    const own = mailboxEmail.toLowerCase();
    const recipients = all
      ? [
          ...new Set(
            [...defaultTo, ...message.to].map((email) => email.toLowerCase())
          ),
        ].filter((email) => email !== own)
      : defaultTo;
    return {
      to: recipients,
      cc: all
        ? message.cc.filter(
            (email) =>
              email.toLowerCase() !== own &&
              !recipients.includes(email.toLowerCase())
          )
        : [],
    };
  }
  const initialRecipients = resolvedRecipients(backup?.replyAll ?? false);
  const [recipientInputs, setRecipientInputs] = useState<
    Record<string, string>
  >(backup?.recipientInputs ?? {});
  const [to, setTo] = useState(backup?.to ?? initialRecipients.to);
  const [cc, setCc] = useState<string[]>(backup?.cc ?? initialRecipients.cc);
  const [bcc, setBcc] = useState<string[]>(backup?.bcc ?? []);
  const [pendingFiles, setPendingFiles] = useState<PendingUpload[]>([]);
  const pendingRef = useRef<PendingUpload[]>([]);
  const [filesRestored, setFilesRestored] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [acceptedId, setAcceptedId] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const draftId = useRef(initialDraftId ?? backup?.draftId);
  const revision = useRef(backup?.revision ?? 1);
  const clientId = useRef(backup?.clientId ?? crypto.randomUUID());
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const touched = useRef(Boolean(backup));
  const sent = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const backupId = storageKey ?? `reply.${organizationId}.${message.id}`;
  useEffect(() => {
    let active = true;
    void listPendingDrafts(organizationId).then((drafts) => {
      if (!active) return;
      const saved = drafts.find((entry) => entry.localId === backupId);
      if (saved && !backup) {
        setRecipientInputs(
          (saved.payload.variables?.qqueueRecipientInputs as Record<
            string,
            string
          >) ?? {}
        );
        setSignature(signatureStamp(saved.payload.variables?.qqueueSignature));
        setHtml(saved.payload.html);
        setTo(saved.payload.to);
        setCc(saved.payload.cc);
        setBcc(saved.payload.bcc);
        draftId.current = saved.draftId ?? undefined;
        revision.current = saved.revision ?? 1;
        touched.current = true;
      }
      pendingRef.current = saved?.pendingUploads ?? [];
      setPendingFiles(pendingRef.current);
      setFilesRestored(true);
    });
    return () => {
      active = false;
    };
  }, [organizationId, backupId]);
  function updateFiles(files: PendingUpload[]) {
    pendingRef.current = files;
    setPendingFiles(files);
  }
  const writing = useRef({
    html,
    to,
    cc,
    bcc,
    replyAll,
    recipientInputs,
    signature,
  });
  writing.current = { html, to, cc, bcc, replyAll, recipientInputs, signature };
  function pendingRecord(emailDraftId = draftId.current ?? null): PendingDraft {
    const current = writing.current;
    return {
      userId: user?.id ?? "",
      localId: backupId,
      organizationId,
      draftId: emailDraftId,
      revision: revision.current,
      updatedAt: new Date().toISOString(),
      pendingUploads: pendingRef.current,
      payload: {
        inboundMessageId: message.id,
        subject,
        html: current.html,
        to: current.to,
        cc: current.cc,
        bcc: current.bcc,
        listIds: [],
        variables: {
          qqueueSignature: current.signature,
          qqueueEditableRecipients: true,
          qqueueReplyAll: current.replyAll,
          qqueueRecipientInputs: current.recipientInputs,
        },
      },
    };
  }
  const latest = useRef("");
  latest.current = JSON.stringify({
    html,
    signature,
    to,
    cc,
    bcc,
    attachments,
    pendingFiles,
    replyAll,
    recipientInputs,
  });
  const subject = /^re:/i.test(message.subject)
    ? message.subject
    : `Re: ${message.subject || "(no subject)"}`;

  const draftQuery = useOrgQuery(
    organizationId,
    ["reply-draft", organizationId, user?.id, message.id, initialDraftId],
    async () => {
      if (draftId.current) return api.getEmailDraft(draftId.current);
      const drafts = await api.listEmailDrafts(organizationId);
      const existing = drafts.find(
        (draft) => draft.inboundMessageId === message.id
      );
      return existing ? api.getEmailDraft(existing.id) : null;
    },
    { enabled: filesRestored }
  );
  const loadedDraft = useRef(false);
  useEffect(() => {
    const draft = draftQuery.data;
    if (!draft) return;
    draftId.current = draft.id;
    if (draft.completedSendId) {
      setAcceptedId(draft.completedSendId);
      sent.current = true;
    }
    if (
      ((backup?.draftId &&
        backup.revision &&
        backup.revision !== draft.revision) ||
        (loadedDraft.current &&
          touched.current &&
          revision.current !== (draft.revision ?? 1))) &&
      !draft.completedSendId
    ) {
      setConflict(true);
    } else if (!loadedDraft.current) revision.current = draft.revision ?? 1;
    loadedDraft.current = true;
    if (!touched.current) {
      setSignature(signatureStamp(draft.variables?.qqueueSignature));
      setHtml(draft.html ?? "");
      setAttachments(draft.attachments ?? []);
      setRecipientInputs(
        (draft.variables?.qqueueRecipientInputs as Record<string, string>) ?? {}
      );
      setReplyAll(Boolean(draft.variables?.qqueueReplyAll));
      const legacyAll = Boolean(
        draft.variables?.qqueueReplyAll &&
        !draft.variables?.qqueueEditableRecipients
      );
      const resolved = resolvedRecipients(legacyAll);
      setTo(legacyAll ? resolved.to : (draft.to ?? defaultTo));
      setCc(legacyAll ? resolved.cc : (draft.cc ?? []));
      setBcc(draft.bcc ?? []);
      setSaved(true);
    }
  }, [draftQuery.data]);

  const save = useApiMutation(
    async (body: string) => {
      const fingerprint = latest.current;
      const recipients = { to, cc, bcc, replyAll, recipientInputs, signature };
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
            to: recipients.to,
            cc: recipients.cc,
            bcc: recipients.bcc,
            variables: {
              qqueueSignature: recipients.signature,
              qqueueEditableRecipients: true,
              qqueueReplyAll: recipients.replyAll,
              qqueueRecipientInputs: recipients.recipientInputs,
            },
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
          setSaved(fingerprint === latest.current);
          const pending = (await listPendingDrafts(organizationId)).find(
            (entry) => entry.localId === backupId
          );
          if (pending)
            await acknowledgePendingDraft(pending, draft.id, draft.revision);
          try {
            if (storageKey) {
              const current = JSON.parse(
                localStorage.getItem(storageKey) ?? "null"
              );
              localStorage.setItem(
                storageKey,
                JSON.stringify({
                  ...current,
                  draftId: draft.id,
                  revision: revision.current,
                  clientId: clientId.current,
                })
              );
            }
          } catch {
            setStorageError(true);
          }
          return draft.id;
        });
      saveChain.current = work;
      return work;
    },
    {
      errorMessage:
        "Couldn't save to the server. Keep this reply open and try again.",
      onError: (error) => {
        setSaved(false);
        if (
          typeof error === "object" &&
          error !== null &&
          "status" in error &&
          error.status === 409
        )
          setConflict(true);
      },
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
            signature,
            recipientInputs,
            to,
            cc,
            bcc,
            attachments,
            replyAll,
            draftId: draftId.current,
            revision: revision.current,
            clientId: clientId.current,
          })
        );
      } catch {
        setStorageError(true);
      }
    }
    // Keep the latest writing beside retryable file bytes, even when browser
    // localStorage is full. A server acknowledgement updates this revision.
    if (filesRestored && pendingRef.current.length && draftId.current)
      void savePendingDraft(pendingRecord());
    if (draftQuery.isPending || draftQuery.isError) return;
    if (conflict || acceptedId || !filesRestored) return;
    const timer = window.setTimeout(() => save.mutate(html), 1500);
    return () => window.clearTimeout(timer);
  }, [
    html,
    signature,
    recipientInputs,
    to,
    cc,
    bcc,
    attachments,
    pendingFiles,
    replyAll,
    storageKey,
    draftQuery.isPending,
    draftQuery.isError,
    filesRestored,
    conflict,
    acceptedId,
  ]);

  const send = useApiMutation(
    async () => {
      const savedDraftId = await save.mutateAsync(html);
      if (!savedDraftId) throw new Error("Save your reply before sending it.");
      let result;
      try {
        result = await api.replyToInboundMessage(message.id, {
          organizationId,
          subject,
          html,
          replyAll,
          to,
          cc,
          bcc,
          idempotencyKey: savedDraftId,
          draftId: savedDraftId,
          expectedRevision: revision.current,
          attachmentIds: attachments.map((file) => file.id),
        });
      } catch (error) {
        const recovered = await api
          .getEmailDraft(savedDraftId)
          .catch(() => null);
        if (!recovered?.completedSendId) throw error;
        result = { id: recovered.completedSendId, status: "QUEUED" };
      }
      sent.current = true;
      await deletePendingDraft(backupId);
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

  async function processFiles(entries: PendingUpload[]) {
    setUploading(true);
    try {
      const emailDraftId = await save.mutateAsync(html);
      if (!emailDraftId)
        throw new Error("Save this reply before attaching files.");
      const persisted = await savePendingDraft(pendingRecord(emailDraftId));
      if (!persisted) setStorageError(true);
      for (const entry of entries) {
        try {
          const uploaded = await api.uploadAttachment(entry.file, {
            organizationId,
            emailDraftId,
            uploadId: entry.uploadId,
          });
          touched.current = true;
          setAttachments((current) =>
            current.some((file) => file.id === uploaded.id)
              ? current
              : [...current, uploaded]
          );
          updateFiles(
            pendingRef.current.filter(
              (file) => file.uploadId !== entry.uploadId
            )
          );
        } catch (error) {
          updateFiles(
            pendingRef.current.map((file) =>
              file.uploadId === entry.uploadId
                ? {
                    ...file,
                    error:
                      error instanceof Error
                        ? error.message
                        : "Upload interrupted. Try again.",
                  }
                : file
            )
          );
        }
      }
    } catch (error) {
      updateFiles(
        pendingRef.current.map((file) => ({
          ...file,
          error:
            error instanceof Error
              ? error.message
              : "Couldn't prepare attachment.",
        }))
      );
    } finally {
      setUploading(false);
      if (!pendingRef.current.length) await deletePendingDraft(backupId);
      else await savePendingDraft(pendingRecord());
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const entries = Array.from(files).map((file) => ({
      file,
      uploadId: crypto.randomUUID(),
      error: "Waiting to upload",
    }));
    updateFiles([...pendingRef.current, ...entries]);
    await processFiles(entries);
  }

  const remove = useApiMutation(async (id: string) => {
    await api.deleteAttachment(id);
    setAttachments((current) => current.filter((file) => file.id !== id));
  });
  const empty =
    !html
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim() && !/<img\b/i.test(html);
  function close() {
    if (send.isPending || uploading) return;
    if (storageError && touched.current && !saved) {
      toast.error(
        "Keep this reply open until it can be saved. Device storage is unavailable."
      );
      return;
    }
    if (
      touched.current &&
      !conflict &&
      !acceptedId &&
      !draftQuery.isPending &&
      !draftQuery.isError
    )
      save.mutate(html);
    onClose();
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !empty &&
      !pendingFiles.length &&
      !conflict &&
      !acceptedId &&
      to.length + cc.length + bcc.length > 0 &&
      !uploading &&
      !send.isPending &&
      message.bodyStatus !== "UNAVAILABLE"
    )
      send.mutate();
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
            {message.bodyStatus === "UNAVAILABLE" ? (
              <p role="alert" className="text-ui text-warn">
                Reload the original message before sending this reply. Your
                draft can still be saved.
              </p>
            ) : null}
            <RecipientField
              id="reply-to-addresses"
              pendingValue={recipientInputs["reply-to-addresses"] ?? ""}
              onPendingChange={(value) => {
                touched.current = true;
                setSaved(false);
                setRecipientInputs((current) => ({
                  ...current,
                  "reply-to-addresses": value,
                }));
              }}
              label="To"
              emails={to}
              onChange={(value) => {
                touched.current = true;
                setSaved(false);
                setTo(value);
              }}
              disabled={send.isPending || Boolean(acceptedId)}
            />
            <RecipientField
              id="reply-cc-addresses"
              pendingValue={recipientInputs["reply-cc-addresses"] ?? ""}
              onPendingChange={(value) => {
                touched.current = true;
                setSaved(false);
                setRecipientInputs((current) => ({
                  ...current,
                  "reply-cc-addresses": value,
                }));
              }}
              label="Cc"
              emails={cc}
              onChange={(value) => {
                touched.current = true;
                setSaved(false);
                setCc(value);
              }}
              disabled={send.isPending || Boolean(acceptedId)}
            />
            <RecipientField
              id="reply-bcc-addresses"
              pendingValue={recipientInputs["reply-bcc-addresses"] ?? ""}
              onPendingChange={(value) => {
                touched.current = true;
                setSaved(false);
                setRecipientInputs((current) => ({
                  ...current,
                  "reply-bcc-addresses": value,
                }));
              }}
              label="Bcc"
              emails={bcc}
              onChange={(value) => {
                touched.current = true;
                setSaved(false);
                setBcc(value);
              }}
              disabled={send.isPending || Boolean(acceptedId)}
            />
            {message.to.length + message.cc.length > 1 ? (
              <label className="flex items-center gap-2 text-ui">
                <input
                  type="checkbox"
                  checked={replyAll}
                  disabled={send.isPending || Boolean(acceptedId)}
                  onChange={(event) => {
                    touched.current = true;
                    setSaved(false);
                    setReplyAll(event.target.checked);
                    const next = resolvedRecipients(event.target.checked);
                    setTo(next.to);
                    setCc(next.cc);
                  }}
                />{" "}
                Reply to everyone
              </label>
            ) : null}
            <SignatureControl
              organizationId={organizationId}
              mailboxEmail={mailboxEmail}
              value={html}
              onChange={(value) => {
                touched.current = true;
                setSaved(false);
                setHtml(value);
              }}
              stamp={signature}
              onStamp={setSignature}
              autoReady={
                filesRestored &&
                !draftQuery.isPending &&
                !draftQuery.data &&
                !backup
              }
              generation={backupId}
              disabled={send.isPending || Boolean(acceptedId)}
            />
            <BodyEditor
              compactToolbar
              disabled={send.isPending || Boolean(acceptedId)}
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
                draftQuery.isError ||
                conflict ||
                Boolean(acceptedId)
              }
              onClick={() => fileInput.current?.click()}
            >
              {uploading ? <Spinner /> : <Paperclip />} Attach files
            </Button>
            {pendingFiles.map((entry) => (
              <div
                key={entry.uploadId}
                role="alert"
                className="space-y-2 text-ui"
              >
                <p>
                  {entry.file.name}: {entry.error}
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={uploading || send.isPending}
                  onClick={() => void processFiles([entry])}
                >
                  Retry {entry.file.name}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={uploading || send.isPending}
                  onClick={() => {
                    updateFiles(
                      pendingRef.current.filter(
                        (file) => file.uploadId !== entry.uploadId
                      )
                    );
                    if (pendingRef.current.length === 0)
                      void deletePendingDraft(backupId);
                  }}
                >
                  Remove pending {entry.file.name}
                </Button>
              </div>
            ))}
            {conflict ? (
              <DraftConflictReview
                organizationId={organizationId}
                draftId={draftId.current}
                clientId={clientId.current}
                onAccepted={(id) => {
                  sent.current = true;
                  setAcceptedId(id);
                }}
                onUse={(current) => {
                  draftId.current = current.id;
                  revision.current = current.revision ?? 1;
                  setSignature(
                    signatureStamp(current.variables?.qqueueSignature)
                  );
                  setHtml(current.html ?? "");
                  setTo(current.to ?? defaultTo);
                  setCc(current.cc ?? []);
                  setBcc(current.bcc ?? []);
                  setRecipientInputs(
                    (current.variables?.qqueueRecipientInputs as Record<
                      string,
                      string
                    >) ?? {}
                  );
                  setAttachments(current.attachments ?? []);
                  setReplyAll(Boolean(current.variables?.qqueueReplyAll));
                  setConflict(false);
                  setSaved(true);
                }}
              />
            ) : null}
            {acceptedId ? (
              <p role="status">
                This reply was already accepted. Check its progress in Outbox.
              </p>
            ) : null}
            {storageError ? (
              <p role="alert">
                Device backup is unavailable. Keep this reply open until the
                server confirms it is saved.
              </p>
            ) : null}
            <ul className="space-y-2">
              {attachments.map((file) => (
                <li key={file.id} className="flex items-center gap-2 text-ui">
                  <span className="min-w-0 flex-1 truncate">
                    {file.filename} · {formatBytes(file.size)}
                  </span>
                  <IconButton
                    label={`Remove ${file.filename}`}
                    disabled={
                      send.isPending || remove.isPending || Boolean(acceptedId)
                    }
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
              !filesRestored ||
              pendingFiles.length > 0 ||
              conflict ||
              Boolean(acceptedId) ||
              to.length + cc.length + bcc.length === 0 ||
              message.bodyStatus === "UNAVAILABLE" ||
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
