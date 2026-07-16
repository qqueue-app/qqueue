import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileText,
  Paperclip,
  Plus,
  Save,
  Search,
  Send,
  Trash2,
  Users,
  X
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { RichTextEditor } from "../components/editor/RichTextEditor.js";
import {
  buildCron,
  describeCron,
  emptyRecurrence,
  ScheduleControls
} from "../components/ScheduleControls.js";
import {
  api,
  type Contact,
  type ContactList,
  type EmailAttachment,
  type EmailDraft,
  type ManualEmailDeliveryStatus,
  type RecipientDelivery,
  type SMTPConnection,
  type Template
} from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card } from "../components/ui/card.js";
import { Checkbox } from "../components/ui/checkbox.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { Spinner } from "../components/ui/spinner.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../components/ui/dialog.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../components/ui/select.js";

const DEFAULT_SMTP = "__default__";
const NO_TEMPLATE = "__none__";
const AUTOSAVE_DELAY_MS = 2000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(value: string) {
  return EMAIL_RE.test(value.trim());
}

function htmlIsEmpty(html: string) {
  const stripped = html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
  return stripped === "" && !/<(img|hr|br)/i.test(html);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface RecipientFieldProps {
  id: string;
  label: string;
  emails: string[];
  onChange: (emails: string[]) => void;
  onRemoveField?: () => void;
}

// A simple chip input: type an address and press Enter/comma to add it. Used for
// the To/CC/BCC fields. Invalid or duplicate addresses are rejected on commit.
function RecipientField({
  id,
  label,
  emails,
  onChange,
  onRemoveField
}: RecipientFieldProps) {
  const [value, setValue] = useState("");

  function commit(raw: string) {
    const parts = raw
      .split(/[,;\s]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) {
      return;
    }
    const next = [...emails];
    for (const part of parts) {
      if (!isValidEmail(part)) {
        toast.error(`"${part}" is not a valid email address.`);
        continue;
      }
      if (next.some((email) => email.toLowerCase() === part.toLowerCase())) {
        continue;
      }
      next.push(part);
    }
    onChange(next);
    setValue("");
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        {onRemoveField ? (
          <button
            type="button"
            onClick={onRemoveField}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Remove
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5 rounded-lg border border-input bg-card p-1.5 shadow-sm focus-within:ring-2 focus-within:ring-ring">
        {emails.map((email) => (
          <Badge key={email} variant="secondary" className="gap-1 font-normal">
            {email}
            <button
              type="button"
              aria-label={`Remove ${email}`}
              onClick={() =>
                onChange(emails.filter((current) => current !== email))
              }
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <input
          id={id}
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              commit(value);
            } else if (
              event.key === "Backspace" &&
              value === "" &&
              emails.length > 0
            ) {
              onChange(emails.slice(0, -1));
            }
          }}
          onBlur={() => commit(value)}
          placeholder={emails.length === 0 ? "name@example.com" : ""}
          className="min-w-[12ch] flex-1 bg-transparent px-1.5 py-0.5 text-sm outline-none"
        />
      </div>
    </div>
  );
}

export function EmailStudio() {
  const { currentOrganizationId: organizationId } = useSession();

  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [smtpConnections, setSMTPConnections] = useState<SMTPConnection[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactLists, setContactLists] = useState<ContactList[]>([]);
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);

  // Composer state.
  const [smtpConnectionId, setSMTPConnectionId] = useState(DEFAULT_SMTP);
  const [templateId, setTemplateId] = useState(NO_TEMPLATE);
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [toEmails, setToEmails] = useState<string[]>([]);
  const [ccEmails, setCcEmails] = useState<string[]>([]);
  const [bccEmails, setBccEmails] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [selectedListIds, setSelectedListIds] = useState<string[]>([]);
  const [replyTo, setReplyTo] = useState("");
  const [attachments, setAttachments] = useState<EmailAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [scheduleForLater, setScheduleForLater] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [recurrence, setRecurrence] = useState(emptyRecurrence);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Per-recipient delivery status, shown after a send completes.
  const [deliveryStatus, setDeliveryStatus] =
    useState<ManualEmailDeliveryStatus | null>(null);

  // UI state.
  const [sending, setSending] = useState(false);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [listPickerOpen, setListPickerOpen] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [deleteDraftTarget, setDeleteDraftTarget] = useState<EmailDraft | null>(
    null
  );

  // Drafts.
  const [draftId, setDraftId] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const hasContent =
    subject.trim() !== "" ||
    !htmlIsEmpty(html) ||
    toEmails.length > 0 ||
    selectedListIds.length > 0;

  const selectedLists = useMemo(
    () => contactLists.filter((list) => selectedListIds.includes(list.id)),
    [contactLists, selectedListIds]
  );

  const listMemberEstimate = useMemo(
    () =>
      selectedLists.reduce(
        (sum, list) => sum + (list._count?.contacts ?? 0),
        0
      ),
    [selectedLists]
  );

  const totalRecipients =
    toEmails.length + ccEmails.length + bccEmails.length + listMemberEstimate;

  const load = useCallback(async () => {
    if (!organizationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [templateData, smtpData, contactData, listData, draftData] =
        await Promise.all([
          api.listTemplates(organizationId),
          api.listSMTPConnections(organizationId),
          api.listContacts(organizationId),
          api.listContactLists(organizationId),
          api.listEmailDrafts(organizationId)
        ]);
      setTemplates(templateData);
      setSMTPConnections(smtpData);
      setContacts(contactData);
      setContactLists(listData);
      setDrafts(draftData);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load Email Studio"
      );
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetComposer() {
    setSMTPConnectionId(DEFAULT_SMTP);
    setTemplateId(NO_TEMPLATE);
    setSubject("");
    setHtml("");
    setToEmails([]);
    setCcEmails([]);
    setBccEmails([]);
    setShowCc(false);
    setShowBcc(false);
    setSelectedListIds([]);
    setReplyTo("");
    setAttachments([]);
    setScheduleForLater(false);
    setScheduledAt("");
    setRecurring(false);
    setRecurrence(emptyRecurrence);
    setDraftId(null);
    setLastSavedAt(null);
  }

  function selectTemplate(value: string) {
    setTemplateId(value);
    if (value === NO_TEMPLATE) {
      return;
    }
    const template = templates.find((item) => item.id === value);
    if (!template) {
      return;
    }
    // Loading a template overwrites the composer, so confirm first if the user
    // has already started writing. The original template row is never written
    // back to, so edits here never alter the saved template.
    const hasContent =
      subject.trim() !== "" || html.replace(/<[^>]*>/g, "").trim() !== "";
    if (
      hasContent &&
      !window.confirm(
        "Replace the current subject and message with this template?"
      )
    ) {
      return;
    }
    setSubject(template.subject);
    setHtml(template.html);
    toast.success(`Loaded "${template.name}".`);
  }

  function addContacts(selected: Contact[]) {
    const next = [...toEmails];
    for (const contact of selected) {
      if (
        !next.some((email) => email.toLowerCase() === contact.email.toLowerCase())
      ) {
        next.push(contact.email);
      }
    }
    setToEmails(next);
  }

  async function handleFileSelect(event: FormEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    // Reset the input so selecting the same file again still fires onChange.
    input.value = "";
    if (files.length === 0 || !organizationId) {
      return;
    }

    setUploading(true);
    try {
      // Link uploads to the draft so resuming it restores the attachments. Make
      // sure a draft exists first (the composer otherwise only auto-saves once
      // there is content worth keeping).
      const ensuredDraftId = draftId ?? (await saveDraft(true)) ?? undefined;
      for (const file of files) {
        try {
          const attachment = await api.uploadAttachment(file, {
            organizationId,
            emailDraftId: ensuredDraftId
          });
          setAttachments((current) => [...current, attachment]);
        } catch (error) {
          toast.error(
            error instanceof Error
              ? `${file.name}: ${error.message}`
              : `Unable to upload ${file.name}`
          );
        }
      }
    } finally {
      setUploading(false);
    }
  }

  /**
   * Editor images are not attachments: they are hosted publicly so recipients'
   * mail clients can load them, and the editor embeds the returned URL. Errors
   * propagate so the image dialog can show them inline.
   */
  async function uploadInlineImage(file: File) {
    if (!organizationId) {
      throw new Error("Select an organization first");
    }
    const image = await api.uploadImage(file, { organizationId });
    return image.url;
  }

  async function removeAttachment(id: string) {
    try {
      await api.deleteAttachment(id);
      setAttachments((current) => current.filter((item) => item.id !== id));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to remove attachment"
      );
    }
  }

  const saveDraft = useCallback(
    async (silent: boolean): Promise<string | null> => {
      if (!organizationId) {
        return null;
      }
      setSavingDraft(true);
      try {
        const payload = {
          subject,
          html,
          to: toEmails,
          cc: ccEmails,
          bcc: bccEmails,
          listIds: selectedListIds,
          replyTo: replyTo || undefined,
          smtpConnectionId:
            smtpConnectionId === DEFAULT_SMTP ? undefined : smtpConnectionId,
          templateId: templateId === NO_TEMPLATE ? undefined : templateId
        };
        let saved: EmailDraft;
        if (draftId) {
          saved = await api.updateEmailDraft(draftId, payload);
        } else {
          saved = await api.createEmailDraft({ organizationId, ...payload });
          setDraftId(saved.id);
        }
        setLastSavedAt(saved.updatedAt);
        if (!silent) {
          toast.success("Draft saved.");
        }
        return saved.id;
      } catch (error) {
        if (!silent) {
          toast.error(
            error instanceof Error ? error.message : "Unable to save draft"
          );
        }
        return null;
      } finally {
        setSavingDraft(false);
      }
    },
    [
      organizationId,
      subject,
      html,
      toEmails,
      ccEmails,
      bccEmails,
      selectedListIds,
      replyTo,
      smtpConnectionId,
      templateId,
      draftId
    ]
  );

  // Auto-save: debounce composer changes and persist quietly once there is
  // something worth keeping.
  const autoSaveRef = useRef(saveDraft);
  autoSaveRef.current = saveDraft;
  useEffect(() => {
    if (!organizationId || !hasContent || sending) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void autoSaveRef.current(true);
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [
    subject,
    html,
    toEmails,
    ccEmails,
    bccEmails,
    selectedListIds,
    replyTo,
    smtpConnectionId,
    templateId
  ]);

  async function loadDraft(summary: EmailDraft) {
    // The drafts list omits attachments; fetch the full draft so resuming
    // restores its files too. Fall back to the summary if the fetch fails.
    let draft = summary;
    try {
      draft = await api.getEmailDraft(summary.id);
    } catch {
      // Use the summary as-is; attachments simply won't be restored.
    }
    setDraftId(draft.id);
    setSubject(draft.subject ?? "");
    setHtml(draft.html ?? "");
    setToEmails(draft.to ?? []);
    setCcEmails(draft.cc ?? []);
    setBccEmails(draft.bcc ?? []);
    setShowCc((draft.cc?.length ?? 0) > 0);
    setShowBcc((draft.bcc?.length ?? 0) > 0);
    setSelectedListIds(draft.listIds ?? []);
    setReplyTo(draft.replyTo ?? "");
    setAttachments(draft.attachments ?? []);
    setSMTPConnectionId(draft.smtpConnectionId ?? DEFAULT_SMTP);
    setTemplateId(draft.templateId ?? NO_TEMPLATE);
    setLastSavedAt(draft.updatedAt);
    setDeliveryStatus(null);
    setDraftsOpen(false);
    toast.success("Draft loaded.");
  }

  async function confirmDeleteDraft() {
    if (!deleteDraftTarget) {
      return;
    }
    try {
      await api.deleteEmailDraft(deleteDraftTarget.id);
      if (deleteDraftTarget.id === draftId) {
        resetComposer();
      }
      setDeleteDraftTarget(null);
      setDrafts(await api.listEmailDrafts(organizationId!));
      toast.success("Draft deleted.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to delete draft"
      );
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) {
      toast.error("Select an organization in Settings first.");
      return;
    }
    if (toEmails.length === 0 && selectedListIds.length === 0) {
      toast.error("Add at least one recipient.");
      return;
    }
    if (!subject.trim()) {
      toast.error("Add a subject.");
      return;
    }
    if (htmlIsEmpty(html)) {
      toast.error("The email body cannot be empty.");
      return;
    }

    let scheduledAtIso: string | undefined;
    if (recurring) {
      const cron = buildCron(recurrence);
      if (!describeCron(cron)) {
        toast.error("Enter a valid schedule.");
        return;
      }
      // TODO: Persist recurring manual sends once Compose has a recurring
      // draft/job model. Campaign recurrence is currently campaign-only.
      toast.error("Recurring one-off sends aren't wired up yet.");
      return;
    }
    if (scheduleForLater) {
      if (!scheduledAt) {
        toast.error("Pick a date and time to schedule.");
        return;
      }
      const date = new Date(scheduledAt);
      if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
        toast.error("Scheduled time must be in the future.");
        return;
      }
      scheduledAtIso = date.toISOString();
    }

    setSending(true);
    try {
      const result = await api.sendManualEmail({
        organizationId,
        to: toEmails,
        cc: ccEmails.length ? ccEmails : undefined,
        bcc: bccEmails.length ? bccEmails : undefined,
        listIds: selectedListIds.length ? selectedListIds : undefined,
        replyTo: replyTo || undefined,
        smtpConnectionId:
          smtpConnectionId === DEFAULT_SMTP ? undefined : smtpConnectionId,
        templateId: templateId === NO_TEMPLATE ? undefined : templateId,
        subject,
        html,
        attachmentIds: attachments.length
          ? attachments.map((item) => item.id)
          : undefined,
        scheduledAt: scheduledAtIso
      });
      // The send succeeded — discard the working draft so it doesn't linger.
      if (draftId) {
        await api.deleteEmailDraft(draftId).catch(() => undefined);
      }
      toast.success(
        result.status === "QUEUED"
          ? `Email scheduled (job ${result.id}).`
          : `Email sent (job ${result.id}).`
      );
      resetComposer();
      setDrafts(await api.listEmailDrafts(organizationId));
      // Surface per-recipient delivery status for the just-created job.
      try {
        setDeliveryStatus(
          await api.manualEmailStatus(result.id, organizationId)
        );
      } catch {
        // Non-fatal: the send already succeeded.
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to send email");
    } finally {
      setSending(false);
    }
  }

  const noSmtp = !loading && smtpConnections.length === 0;

  return (
    <>
      <PageHeader
        title="Compose"
        description="Write and send a one-off email through your delivery pipeline."
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDraftsOpen(true)}
              disabled={!organizationId}
            >
              <FileText className="h-4 w-4" />
              Drafts{drafts.length ? ` (${drafts.length})` : ""}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void saveDraft(false)}
              disabled={!organizationId || savingDraft || !hasContent}
            >
              {savingDraft ? <Spinner /> : <Save className="h-4 w-4" />}
              Save draft
            </Button>
          </div>
        }
      />

      <section className="p-5 sm:p-6">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <form onSubmit={send} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-5">
              {noSmtp ? (
                <Card className="border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                  <p className="font-medium">No sending account yet</p>
                  <p className="mt-1">
                    Add a sending account before you can send email.
                  </p>
                </Card>
              ) : null}

              <Card className="space-y-5 p-5">
                <div>
                  <h2 className="text-base font-semibold">Message details</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Choose the sender, recipients, and subject before writing.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="from">From</Label>
                    <Select
                      value={smtpConnectionId}
                      onValueChange={setSMTPConnectionId}
                    >
                      <SelectTrigger id="from">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={DEFAULT_SMTP}>
                          Default sending account
                        </SelectItem>
                        {smtpConnections.map((connection) => (
                          <SelectItem key={connection.id} value={connection.id}>
                            {connection.fromName
                              ? `${connection.fromName} <${connection.fromEmail}>`
                              : connection.fromEmail}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="replyTo">Reply-To</Label>
                    <Input
                      id="replyTo"
                      type="email"
                      placeholder="optional"
                      value={replyTo}
                      onChange={(event) => setReplyTo(event.target.value)}
                    />
                  </div>
                </div>

                <RecipientField
                  id="to"
                  label="To"
                  emails={toEmails}
                  onChange={setToEmails}
                />

                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setContactPickerOpen(true)}
                  >
                    <Users className="h-4 w-4" />
                    Add contacts
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setListPickerOpen(true)}
                  >
                    <Users className="h-4 w-4" />
                    Add list
                  </Button>
                  {!showCc ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowCc(true)}
                    >
                      <Plus className="h-4 w-4" />
                      Cc
                    </Button>
                  ) : null}
                  {!showBcc ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowBcc(true)}
                    >
                      <Plus className="h-4 w-4" />
                      Bcc
                    </Button>
                  ) : null}
                </div>

                {selectedLists.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedLists.map((list) => (
                      <Badge key={list.id} variant="outline" className="gap-1">
                        {list.name} ({list._count?.contacts ?? 0})
                        <button
                          type="button"
                          aria-label={`Remove ${list.name}`}
                          onClick={() =>
                            setSelectedListIds((current) =>
                              current.filter((id) => id !== list.id)
                            )
                          }
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                ) : null}

                {showCc ? (
                  <RecipientField
                    id="cc"
                    label="Cc"
                    emails={ccEmails}
                    onChange={setCcEmails}
                    onRemoveField={() => {
                      setShowCc(false);
                      setCcEmails([]);
                    }}
                  />
                ) : null}
                {showBcc ? (
                  <RecipientField
                    id="bcc"
                    label="Bcc"
                    emails={bccEmails}
                    onChange={setBccEmails}
                    onRemoveField={() => {
                      setShowBcc(false);
                      setBccEmails([]);
                    }}
                  />
                ) : null}

                <div className="space-y-2">
                  <Label htmlFor="subject">Subject</Label>
                  <Input
                    id="subject"
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                    placeholder="Subject line"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Attachments</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading || !organizationId}
                    >
                      {uploading ? (
                        <Spinner />
                      ) : (
                        <Paperclip className="h-4 w-4" />
                      )}
                      Add files
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      aria-label="Add attachments"
                      className="hidden"
                      onChange={handleFileSelect}
                    />
                  </div>
                  {attachments.length > 0 ? (
                    <ul className="space-y-1.5">
                      {attachments.map((attachment) => (
                        <li
                          key={attachment.id}
                          className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
                        >
                          <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">
                            {attachment.filename}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatBytes(attachment.size)}
                          </span>
                          <button
                            type="button"
                            aria-label={`Remove ${attachment.filename}`}
                            onClick={() => void removeAttachment(attachment.id)}
                            className="shrink-0 text-muted-foreground hover:text-destructive"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No attachments added.
                    </p>
                  )}
                </div>
              </Card>

              <Card className="space-y-4 p-5">
                <div>
                  <h2 className="text-base font-semibold">Composer</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Write your message and send it through your delivery
                    pipeline.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Select value={templateId} onValueChange={selectTemplate}>
                    <SelectTrigger
                      className="w-full sm:w-72"
                      aria-label="Template"
                    >
                      <SelectValue placeholder="Start from a template" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_TEMPLATE}>No template</SelectItem>
                      {templates.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <RichTextEditor
                  value={html}
                  onChange={setHtml}
                  placeholder="Write your email…"
                  showVariables={false}
                  onUploadImage={uploadInlineImage}
                />
              </Card>
            </div>

            <div className="space-y-5 xl:sticky xl:top-6 xl:self-start">
              <Card className="space-y-3 p-5">
                <h2 className="text-sm font-semibold">Recipients</h2>
                {totalRecipients === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No recipients yet — add people in the To field above.
                  </p>
                ) : (
                  <>
                    <div className="text-2xl font-semibold tracking-tight">
                      {listMemberEstimate > 0 ? "~" : ""}
                      {totalRecipients}
                      <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                        {totalRecipients === 1 ? "recipient" : "recipients"}
                      </span>
                    </div>
                    <dl className="space-y-1.5 text-sm">
                      {toEmails.length > 0 ? (
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">To</dt>
                          <dd>{toEmails.length}</dd>
                        </div>
                      ) : null}
                      {listMemberEstimate > 0 ? (
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">
                            From lists (approx.)
                          </dt>
                          <dd>{listMemberEstimate}</dd>
                        </div>
                      ) : null}
                      {ccEmails.length > 0 ? (
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Cc</dt>
                          <dd>{ccEmails.length}</dd>
                        </div>
                      ) : null}
                      {bccEmails.length > 0 ? (
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Bcc</dt>
                          <dd>{bccEmails.length}</dd>
                        </div>
                      ) : null}
                    </dl>
                    <p className="text-xs text-muted-foreground">
                      Duplicates are removed automatically when you send.
                    </p>
                  </>
                )}
              </Card>

              <Card className="space-y-4 p-5">
                <div>
                  <h2 className="text-sm font-semibold">Send options</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Send now, or schedule it for later.
                  </p>
                </div>
                <ScheduleControls
                  scheduleEnabled={scheduleForLater}
                  onScheduleEnabledChange={setScheduleForLater}
                  scheduledAt={scheduledAt}
                  onScheduledAtChange={setScheduledAt}
                  recurring={recurring}
                  onRecurringChange={setRecurring}
                  recurrence={recurrence}
                  onRecurrenceChange={setRecurrence}
                  showRecurring={false}
                />

                <Button
                  type="submit"
                  className="w-full"
                  disabled={sending || noSmtp || !organizationId}
                >
                  {sending ? <Spinner /> : <Send className="h-4 w-4" />}
                  {scheduleForLater ? "Schedule email" : "Send email"}
                </Button>
                {lastSavedAt ? (
                  <p className="text-center text-xs text-muted-foreground">
                    Draft saved
                  </p>
                ) : null}
              </Card>

              {deliveryStatus ? (
                <DeliveryStatusCard
                  status={deliveryStatus}
                  onDismiss={() => setDeliveryStatus(null)}
                />
              ) : null}
            </div>
          </form>
        )}
      </section>

      <ContactPickerDialog
        open={contactPickerOpen}
        onOpenChange={setContactPickerOpen}
        contacts={contacts}
        onAdd={addContacts}
      />

      <ListPickerDialog
        open={listPickerOpen}
        onOpenChange={setListPickerOpen}
        lists={contactLists}
        selectedIds={selectedListIds}
        onChange={setSelectedListIds}
      />

      <Dialog open={draftsOpen} onOpenChange={setDraftsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Drafts</DialogTitle>
            <DialogDescription>
              Resume editing a saved draft, or delete one you no longer need.
            </DialogDescription>
          </DialogHeader>
          {drafts.length === 0 ? (
            <div className="rounded-xl border bg-muted/20 py-8 text-center text-sm text-muted-foreground">
              No saved drafts yet.
            </div>
          ) : (
            <div className="max-h-80 space-y-1.5 overflow-auto">
              {drafts.map((draft) => (
                <div
                  key={draft.id}
                  className="flex items-center gap-2 rounded-xl border p-3 transition-colors hover:bg-accent/50"
                >
                  <button
                    type="button"
                    onClick={() => void loadDraft(draft)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate text-sm font-medium">
                      {draft.subject || "(no subject)"}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {draft.to.length || draft.listIds.length
                        ? `${draft.to.join(", ") || `${draft.listIds.length} list(s)`}`
                        : "No recipients"}
                    </div>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Delete draft"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteDraftTarget(draft)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteDraftTarget !== null}
        onOpenChange={(open) => !open && setDeleteDraftTarget(null)}
        title="Delete draft?"
        description="This draft will be permanently removed."
        confirmLabel="Delete"
        onConfirm={confirmDeleteDraft}
      />
    </>
  );
}

const DELIVERY_BADGE: Record<
  RecipientDelivery["status"],
  "default" | "secondary" | "outline" | "destructive"
> = {
  delivered: "default",
  pending: "secondary",
  rejected: "destructive",
  failed: "destructive"
};

// Per-recipient delivery status shown after a send. A manual send is one message
// to many recipients, so granularity comes from the SMTP accepted/rejected
// result plus thread-level engagement events — not separate jobs per recipient.
function DeliveryStatusCard({
  status,
  onDismiss
}: {
  status: ManualEmailDeliveryStatus;
  onDismiss: () => void;
}) {
  return (
    <Card className="space-y-4 p-5" data-testid="delivery-status">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Delivery status</h2>
        <button
          type="button"
          aria-label="Dismiss delivery status"
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-1.5">
        {status.recipients.map((recipient) => (
          <div
            key={`${recipient.field}-${recipient.email}`}
            className="flex items-center justify-between gap-2 text-sm"
          >
            <span className="min-w-0 flex-1 truncate">
              <span className="text-muted-foreground uppercase text-[10px] mr-1.5">
                {recipient.field}
              </span>
              {recipient.email}
            </span>
            <Badge
              variant={DELIVERY_BADGE[recipient.status]}
              className="shrink-0 capitalize"
            >
              {recipient.status}
            </Badge>
          </div>
        ))}
      </div>

      <dl className="grid grid-cols-2 gap-2 border-t pt-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Opens</dt>
          <dd>{status.opens}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Clicks</dt>
          <dd>{status.clicks}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Bounces</dt>
          <dd>{status.bounces}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Complaints</dt>
          <dd>{status.complaints}</dd>
        </div>
      </dl>
    </Card>
  );
}

function ContactPickerDialog({
  open,
  onOpenChange,
  contacts,
  onAdd
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts: Contact[];
  onAdd: (contacts: Contact[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return contacts;
    }
    return contacts.filter((contact) =>
      [contact.email, contact.firstName, contact.lastName]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(query))
    );
  }, [contacts, search]);

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id]
    );
  }

  function confirm() {
    onAdd(contacts.filter((contact) => selected.includes(contact.id)));
    setSelected([]);
    setSearch("");
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          setSelected([]);
          setSearch("");
        }
        onOpenChange(value);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add contacts</DialogTitle>
          <DialogDescription>
            Select contacts to add to the To field.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search contacts…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
        <div className="max-h-72 space-y-1 overflow-auto rounded-md border p-2">
          {filtered.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">
              No contacts found.
            </p>
          ) : (
            filtered.map((contact) => (
              <label
                key={contact.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
              >
                <Checkbox
                  checked={selected.includes(contact.id)}
                  onCheckedChange={() => toggle(contact.id)}
                  aria-label={`Select ${contact.email}`}
                />
                <span className="truncate">{contact.email}</span>
              </label>
            ))
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={confirm} disabled={selected.length === 0}>
            Add {selected.length || ""} contact{selected.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ListPickerDialog({
  open,
  onOpenChange,
  lists,
  selectedIds,
  onChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lists: ContactList[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [draft, setDraft] = useState<string[]>(selectedIds);

  useEffect(() => {
    if (open) {
      setDraft(selectedIds);
    }
  }, [open, selectedIds]);

  function toggle(id: string) {
    setDraft((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id]
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add contact lists</DialogTitle>
          <DialogDescription>
            Everyone in the selected lists receives this email.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-1 overflow-auto rounded-md border p-2">
          {lists.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">
              No contact lists yet.
            </p>
          ) : (
            lists.map((list) => (
              <label
                key={list.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
              >
                <Checkbox
                  checked={draft.includes(list.id)}
                  onCheckedChange={() => toggle(list.id)}
                  aria-label={`Select ${list.name}`}
                />
                <span className="flex-1 truncate">{list.name}</span>
                <span className="text-xs text-muted-foreground">
                  {list._count?.contacts ?? 0}
                </span>
              </label>
            ))
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              onChange(draft);
              onOpenChange(false);
            }}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
