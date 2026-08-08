import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  Eye,
  FileText,
  Paperclip,
  Save,
  Search,
  Send,
  Trash2,
  Users,
  X
} from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "../components/PageContainer.js";
import { PageHeader } from "../components/PageHeader.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { EmptyState } from "../components/EmptyState.js";
import { EmailPreviewFrame } from "../components/EmailPreviewFrame.js";
import { BodyEditor } from "../components/editor/BodyEditor.js";
import {
  Field,
  FormSection,
  FormSections
} from "../components/settings/FormColumn.js";
import {
  buildCron,
  describeCron,
  emptyRecurrence,
  ScheduleControls
} from "../components/ScheduleControls.js";
import {
  ApiError,
  api,
  type Contact,
  type ContactList,
  type EmailAttachment,
  type EmailDraft,
  type EmailPreviewResult,
  type ManualEmailDeliveryStatus,
  type RecipientDelivery,
  type RecipientSuggestion,
  type SMTPConnection,
  type Template
} from "../lib/api.js";
import { formatBytes } from "../lib/format.js";
import { cn } from "../lib/utils.js";
import { useSession } from "../lib/session-context.js";
import { useOnline } from "../lib/use-online.js";
import {
  deletePendingDraft,
  flushPendingDrafts,
  listPendingDrafts,
  savePendingDraft
} from "../lib/offline-drafts.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card } from "../components/ui/card.js";
import { Checkbox } from "../components/ui/checkbox.js";
import { fieldWidths, type FieldWidth } from "../components/ui/field.js";
import { IconButton } from "../components/ui/icon-button.js";
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

function describeRecipientCount(count: number) {
  return count === 1 ? "1 person" : `${count} people`;
}

// Confirmations name the time a message goes out rather than a queue job id.
function formatSendTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit"
  });
}

// How a sending account reads in the From picker and the "sending as" hints.
function describeConnection(connection: SMTPConnection) {
  return connection.fromName
    ? `${connection.fromName} <${connection.fromEmail}>`
    : connection.fromEmail;
}

const MAX_SUGGESTIONS = 8;

/**
 * A key for the local draft queue.
 *
 * `randomUUID` is unavailable on a page served over plain HTTP, which a
 * self-hosted install on a LAN legitimately is — so this can't simply call it
 * and hope.
 */
function newLocalDraftId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

interface RecipientFieldProps {
  id: string;
  label: string;
  emails: string[];
  onChange: (emails: string[]) => void;
  suggestions?: RecipientSuggestion[];
  /** Width by content type — see `fieldWidths`. Recipients are `long` (480px). */
  width?: FieldWidth;
}

// A chip input with autocomplete: type part of a name or address to pick from
// the contact book and previously-mailed addresses, or type a full address and
// press Enter/comma to add it. Used for the To/CC/BCC fields. Invalid or
// duplicate addresses are rejected on commit.
function RecipientField({
  id,
  label,
  emails,
  onChange,
  suggestions = [],
  width = "long"
}: RecipientFieldProps) {
  const [value, setValue] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = value.trim().toLowerCase();
  const matches = useMemo(() => {
    if (query === "") {
      return [];
    }
    const chosen = new Set(emails.map((email) => email.toLowerCase()));
    return suggestions
      .filter(
        (suggestion) =>
          !chosen.has(suggestion.email.toLowerCase()) &&
          (suggestion.email.toLowerCase().includes(query) ||
            (suggestion.name ?? "").toLowerCase().includes(query))
      )
      .slice(0, MAX_SUGGESTIONS);
  }, [suggestions, query, emails]);

  // Reset the highlight whenever the candidate set changes so a stale index
  // can't select the wrong person.
  useEffect(() => {
    setHighlight(0);
  }, [query]);

  function add(candidates: string[]) {
    const next = [...emails];
    for (const candidate of candidates) {
      if (!isValidEmail(candidate)) {
        toast.error(`"${candidate}" is not a valid email address.`);
        continue;
      }
      if (next.some((email) => email.toLowerCase() === candidate.toLowerCase())) {
        continue;
      }
      next.push(candidate);
    }
    onChange(next);
    setValue("");
  }

  function commit(raw: string) {
    const parts = raw
      .split(/[,;\s]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) {
      return;
    }
    add(parts);
  }

  return (
    <Field className={fieldWidths[width]}>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        {/*
          Sized and styled like every other field — same border, same radius,
          same focus outline — but it grows downward as chips wrap instead of
          scrolling sideways. 44px tall on a phone, 36px from the tablet
          breakpoint up, matching `fieldControlHeight`.
        */}
        {/*
          Clicking anywhere in the box types into it. The text input is only
          28px tall inside a 44px box, so without this the padding around it is
          a dead zone on a phone — you tap the field, nothing focuses, and the
          keyboard never comes up. `onMouseDown` with the default prevented, so
          a tap on the padding doesn't blur-then-refocus and lose the caret.
        */}
        <div
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              event.preventDefault();
              inputRef.current?.focus();
            }
          }}
          className={cn(
            "flex min-h-touch w-full cursor-text flex-wrap items-center gap-field sm:min-h-control",
            "rounded-control border border-border-strong bg-surface px-2 py-field",
            "transition-colors duration-fast ease-out hover:border-text-tertiary",
            "focus-within:outline focus-within:outline-2 focus-within:outline-offset-2",
            "focus-within:outline-ring"
          )}
        >
          {emails.map((email) => (
            <Badge key={email} variant="neutral" className="gap-1 pr-1">
              {email}
              <button
                type="button"
                aria-label={`Remove ${email}`}
                onClick={() =>
                  onChange(emails.filter((current) => current !== email))
                }
                className={cn(
                  "relative flex h-4 w-4 items-center justify-center rounded-pill",
                  "text-text-tertiary transition-colors duration-fast ease-out hover:text-err",
                  // A 16px glyph is not a tap target. The chip keeps its size
                  // and grows an invisible 44px hit area on touch layouts only,
                  // the same trick <Button> and <IconButton> use.
                  "after:absolute after:left-1/2 after:top-1/2 after:h-touch after:w-touch",
                  "after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] sm:after:hidden"
                )}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <input
            ref={inputRef}
            id={id}
            type="text"
            inputMode="email"
            value={value}
            autoComplete="off"
            role="combobox"
            aria-expanded={matches.length > 0}
            aria-controls={`${id}-suggestions`}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (matches.length > 0 && event.key === "ArrowDown") {
                event.preventDefault();
                setHighlight((current) => (current + 1) % matches.length);
              } else if (matches.length > 0 && event.key === "ArrowUp") {
                event.preventDefault();
                setHighlight(
                  (current) => (current - 1 + matches.length) % matches.length
                );
              } else if (event.key === "Escape" && matches.length > 0) {
                event.preventDefault();
                setValue("");
              } else if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                const match = matches[highlight];
                if (event.key === "Enter" && match) {
                  add([match.email]);
                } else {
                  commit(value);
                }
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
            // 16px on a phone: anything smaller and iOS zooms the viewport the
            // moment this is focused, and the app is installed to home screens.
            className="min-w-[12ch] flex-1 bg-transparent px-1 py-1 text-base outline-none placeholder:text-text-tertiary sm:text-body"
          />
        </div>
        {matches.length > 0 ? (
          <ul
            id={`${id}-suggestions`}
            role="listbox"
            // scroll-exception: the recipient combobox's listbox — §2 names
            // comboboxes alongside dropdowns as the exception to the one-scroll
            // rule. It floats above the page and can't extend it.
            className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-dialog border border-border bg-popover p-1 shadow-overlay"
          >
            {matches.map((match, index) => (
              <li key={`${match.source}-${match.email}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === highlight}
                  // Commit on mousedown: the input's onBlur would otherwise fire
                  // first and swallow the click.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    add([match.email]);
                  }}
                  onMouseEnter={() => setHighlight(index)}
                  className={cn(
                    "flex min-h-touch w-full items-center gap-2 rounded-control px-2 py-field",
                    "text-left text-body sm:min-h-0",
                    index === highlight && "bg-accent"
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {match.name ? (
                      <>
                        {match.name}{" "}
                        <span className="text-text-secondary">
                          {match.email}
                        </span>
                      </>
                    ) : (
                      match.email
                    )}
                  </span>
                  {match.source === "recent" ? (
                    <span className="shrink-0 text-meta text-text-tertiary">
                      Recent
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Field>
  );
}

export function EmailStudio() {
  const { currentOrganizationId: organizationId } = useSession();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [smtpConnections, setSMTPConnections] = useState<SMTPConnection[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactLists, setContactLists] = useState<ContactList[]>([]);
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);
  const [recentRecipients, setRecentRecipients] = useState<
    RecipientSuggestion[]
  >([]);

  // Composer state.
  const [smtpConnectionId, setSMTPConnectionId] = useState(DEFAULT_SMTP);
  const [templateId, setTemplateId] = useState(NO_TEMPLATE);
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [toEmails, setToEmails] = useState<string[]>([]);
  const [ccEmails, setCcEmails] = useState<string[]>([]);
  const [bccEmails, setBccEmails] = useState<string[]>([]);
  const [selectedListIds, setSelectedListIds] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<EmailAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  /*
    Progressive disclosure (§3). Most sends carbon-copy nobody and attach
    nothing, so neither group is on screen until it is asked for — or until
    something puts content in it, which is what the derived flags below are
    for: a resumed draft with a Bcc must not hide it, and a file that finished
    uploading has to appear somewhere.
  */
  const [copyRevealed, setCopyRevealed] = useState(false);
  const [attachmentsRevealed, setAttachmentsRevealed] = useState(false);
  const [scheduleForLater, setScheduleForLater] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [recurrence, setRecurrence] = useState(emptyRecurrence);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Per-recipient delivery status, shown after a send completes.
  const [deliveryStatus, setDeliveryStatus] =
    useState<ManualEmailDeliveryStatus | null>(null);

  /**
   * Track a just-queued send to its outcome. Every send is asynchronous now
   * (the API only accepts the job; the worker delivers it), so with `follow`
   * this polls the per-recipient status until the job settles — reporting the
   * real result — and without it takes a single snapshot (scheduled sends
   * won't move until their time comes). Best-effort: a failed poll never
   * surfaces as a send error.
   */
  async function pollDeliveryStatus(
    emailJobId: string,
    orgId: string,
    options: { follow: boolean; recipientSummary: string }
  ) {
    const TERMINAL = new Set(["SENT", "FAILED", "SUPPRESSED", "CANCELLED"]);
    const MAX_POLLS = 15;
    const POLL_INTERVAL_MS = 1000;

    try {
      for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }
        const status = await api.manualEmailStatus(emailJobId, orgId);
        setDeliveryStatus(status);
        if (!options.follow) {
          return;
        }
        if (TERMINAL.has(status.status)) {
          if (status.status === "SENT") {
            toast.success(`Sent to ${options.recipientSummary}.`);
          } else if (status.status === "FAILED") {
            toast.error(
              "The email could not be delivered — check the outbox for details."
            );
          }
          return;
        }
      }
    } catch {
      // Non-fatal: the send was already accepted.
    }
  }

  // UI state.
  const [sending, setSending] = useState(false);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [listPickerOpen, setListPickerOpen] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [deleteDraftTarget, setDeleteDraftTarget] = useState<EmailDraft | null>(
    null
  );
  // Applying a template overwrites the composer, so a started message gets a
  // confirmation step first.
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(
    null
  );

  // Preview is server-rendered (same MJML + tracking pass as the send), so it
  // shows the delivered email rather than a dashboard approximation.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<EmailPreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Drafts.
  const [draftId, setDraftId] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  /**
   * The message is safe on this device but the server hasn't got it yet.
   *
   * Distinct from `lastSavedAt`, which means the opposite — that the server
   * has it — because on a phone the difference is the whole story: one of them
   * survives the phone being lost, the other doesn't.
   */
  const [pendingLocally, setPendingLocally] = useState(false);
  /**
   * Identifies this composed message to the local queue for as long as it is
   * being written, and is rotated when the composer is cleared.
   *
   * It can't be `draftId`: a draft written offline has never reached the server
   * and so has no server id to be keyed by.
   */
  const localDraftId = useRef(newLocalDraftId());

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

  // The API resolves "no explicit account" strictly as the connection flagged
  // isDefault — there is no fallback to the first one — so the picker names the
  // same account the send will actually use.
  const defaultConnection = useMemo(
    () => smtpConnections.find((connection) => connection.isDefault),
    [smtpConnections]
  );

  // Contacts first so a saved name wins over a bare address from past sends.
  const recipientSuggestions = useMemo<RecipientSuggestion[]>(() => {
    const seen = new Set<string>();
    const merged: RecipientSuggestion[] = [];
    for (const contact of contacts) {
      const key = contact.email.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push({
        email: contact.email,
        name:
          [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
          null,
        source: "contact"
      });
    }
    for (const recent of recentRecipients) {
      const key = recent.email.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(recent);
    }
    return merged;
  }, [contacts, recentRecipients]);

  const load = useCallback(async () => {
    if (!organizationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [
        templateData,
        smtpData,
        contactData,
        listData,
        draftData,
        recentData
      ] = await Promise.all([
        api.listTemplates(organizationId),
        // Only identities this user may send as (Phase 4): members see their
        // granted accounts, owners/admins see everything.
        api.listSendableSMTPConnections(organizationId),
        api.listContacts(organizationId),
        api.listContactLists(organizationId),
        api.listEmailDrafts(organizationId),
        // Autocomplete is a convenience: never let it fail the whole page.
        api.listRecipientSuggestions(organizationId).catch(() => [])
      ]);
      setTemplates(templateData);
      setSMTPConnections(smtpData);
      setContacts(contactData);
      setContactLists(listData);
      setDrafts(draftData);
      setRecentRecipients(recentData);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't load the composer."
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
    setSelectedListIds([]);
    setAttachments([]);
    setCopyRevealed(false);
    setAttachmentsRevealed(false);
    setScheduleForLater(false);
    setScheduledAt("");
    setRecurring(false);
    setRecurrence(emptyRecurrence);
    setDraftId(null);
    setLastSavedAt(null);
    // Drop this message's local copy and take a fresh key: the next thing typed
    // here is a different email, and must not overwrite the queued one.
    void deletePendingDraft(localDraftId.current);
    localDraftId.current = newLocalDraftId();
    setPendingLocally(false);
  }

  function applyTemplate(value: string) {
    const template = templates.find((item) => item.id === value);
    if (!template) {
      return;
    }
    // The original template row is never written back to, so edits made here
    // never alter the saved template.
    setTemplateId(value);
    setSubject(template.subject);
    setHtml(template.html);
    toast.success(`Loaded "${template.name}".`);
  }

  function selectTemplate(value: string) {
    if (value === NO_TEMPLATE) {
      setTemplateId(value);
      return;
    }
    // Loading a template overwrites the composer, so confirm first if the user
    // has already started writing.
    const started =
      subject.trim() !== "" || html.replace(/<[^>]*>/g, "").trim() !== "";
    if (started) {
      setPendingTemplateId(value);
      return;
    }
    applyTemplate(value);
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
          smtpConnectionId:
            smtpConnectionId === DEFAULT_SMTP ? undefined : smtpConnectionId,
          templateId: templateId === NO_TEMPLATE ? undefined : templateId
        };

        /*
          Local first, network second (§5).

          The order is the whole point: this app is installed on phones, and the
          two-second auto-save below is the only thing standing between a
          half-written email and a tunnel. Writing to IndexedDB before the
          request means the message survives a failed save, a killed tab, and a
          dead battery — the server copy is then just the version other devices
          can see.
        */
        await savePendingDraft({
          localId: localDraftId.current,
          organizationId,
          draftId,
          payload,
          updatedAt: new Date().toISOString()
        });

        let saved: EmailDraft;
        if (draftId) {
          saved = await api.updateEmailDraft(draftId, payload);
        } else {
          saved = await api.createEmailDraft({ organizationId, ...payload });
          setDraftId(saved.id);
        }
        // Acknowledged by the server, so the local copy has done its job.
        await deletePendingDraft(localDraftId.current);
        setLastSavedAt(saved.updatedAt);
        setPendingLocally(false);
        if (!silent) {
          toast.success("Draft saved.");
        }
        return saved.id;
      } catch (error) {
        /*
          Two very different failures wear the same exception here, and telling
          them apart is what keeps the offline queue honest.

          Unreachable (ApiError status 0, or a 5xx) means the draft is fine and
          the network isn't: keep the local record, say so, and let the sync
          replay it. Anything else is the server refusing this content — a
          validation error, a revoked membership — and replaying it would fail
          identically forever, so the record is dropped and the real message
          shown.
        */
        const retryable =
          !(error instanceof ApiError) || error.status === 0 || error.status >= 500;

        if (retryable) {
          setPendingLocally(true);
          if (!silent) {
            toast.message(
              "Saved on this device. It'll sync when the connection is back."
            );
          }
        } else {
          await deletePendingDraft(localDraftId.current);
          setPendingLocally(false);
          if (!silent) {
            toast.error(
              error instanceof Error ? error.message : "Unable to save draft"
            );
          }
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
    smtpConnectionId,
    templateId
  ]);

  /*
    Recover a message the server never received.

    Runs once, and only into an untouched composer: if there is already
    something on screen — a template applied, a deep-linked draft opening —
    silently replacing it with an older local copy would be the data loss this
    is supposed to prevent.
  */
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !organizationId || loading || hasContent) {
      return;
    }
    if (searchParams.get("draft")) {
      return;
    }
    restoredRef.current = true;

    void listPendingDrafts(organizationId).then((pending) => {
      const latest = pending
        .slice()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      if (!latest) {
        return;
      }

      localDraftId.current = latest.localId;
      setDraftId(latest.draftId);
      setSubject(latest.payload.subject);
      setHtml(latest.payload.html);
      setToEmails(latest.payload.to);
      setCcEmails(latest.payload.cc);
      setBccEmails(latest.payload.bcc);
      setSelectedListIds(latest.payload.listIds);
      setSMTPConnectionId(latest.payload.smtpConnectionId ?? DEFAULT_SMTP);
      setTemplateId(latest.payload.templateId ?? NO_TEMPLATE);
      setPendingLocally(true);
      toast.message("Recovered a draft that hadn't finished saving.");
    });
  }, [organizationId, loading, hasContent, searchParams]);

  /*
    Sync on reconnect.

    startDraftSync() in main.tsx flushes the queue app-wide, but a composer that
    is open while the network returns also has to *adopt the result* — take the
    server id its local record was just given — or the next auto-save would
    create a second draft alongside the one that just synced.
  */
  const online = useOnline();
  useEffect(() => {
    if (!online || !organizationId || !pendingLocally) {
      return;
    }

    void flushPendingDrafts(organizationId).then((synced) => {
      const mine = synced.find(
        (entry) => entry.localId === localDraftId.current
      );
      if (!mine) {
        return;
      }
      setDraftId(mine.draft.id);
      setLastSavedAt(mine.draft.updatedAt);
      setPendingLocally(false);
      toast.success("Draft synced.");
    });
  }, [online, organizationId, pendingLocally]);

  const applyDraft = useCallback((draft: EmailDraft) => {
    setDraftId(draft.id);
    setSubject(draft.subject ?? "");
    setHtml(draft.html ?? "");
    setToEmails(draft.to ?? []);
    setCcEmails(draft.cc ?? []);
    setBccEmails(draft.bcc ?? []);
    setSelectedListIds(draft.listIds ?? []);
    setAttachments(draft.attachments ?? []);
    setSMTPConnectionId(draft.smtpConnectionId ?? DEFAULT_SMTP);
    setTemplateId(draft.templateId ?? NO_TEMPLATE);
    setLastSavedAt(draft.updatedAt);
    setDeliveryStatus(null);
    setDraftsOpen(false);
    // A different message is on screen now, so it gets its own queue key — and
    // it arrived from the server, so nothing is pending locally.
    localDraftId.current = newLocalDraftId();
    setPendingLocally(false);
    toast.success("Draft loaded.");
  }, []);

  async function loadDraft(summary: EmailDraft) {
    // The drafts list omits attachments; fetch the full draft so resuming
    // restores its files too. Fall back to the summary if the fetch fails.
    let draft = summary;
    try {
      draft = await api.getEmailDraft(summary.id);
    } catch {
      // Use the summary as-is; attachments simply won't be restored.
    }
    applyDraft(draft);
  }

  // Deep link from the Drafts page: /email-studio?draft=<id>.
  const requestedDraftId = searchParams.get("draft");
  useEffect(() => {
    if (!requestedDraftId) {
      return;
    }
    // Drop the param first so a refresh doesn't re-open the draft over work in
    // progress.
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("draft");
        return next;
      },
      { replace: true }
    );
    api
      .getEmailDraft(requestedDraftId)
      .then(applyDraft)
      .catch(() => toast.error("That draft couldn't be opened."));
  }, [requestedDraftId, applyDraft, setSearchParams]);

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

  /**
   * Render the composed message through the API's preview endpoint, which
   * applies the same MJML wrap and tracking injection the send does. Rendering
   * server-side is the point: a client-side approximation would diverge from the
   * delivered email exactly where it matters (pasted HTML, tracked links).
   */
  async function openPreview() {
    if (!organizationId) {
      toast.error("Select an organization in Settings first.");
      return;
    }
    if (htmlIsEmpty(html)) {
      toast.error("Write something to preview.");
      return;
    }

    setPreviewOpen(true);
    setPreviewing(true);
    setPreview(null);
    try {
      setPreview(
        await api.previewEmail({
          organizationId,
          subject,
          html,
          to: toEmails,
          cc: ccEmails,
          bcc: bccEmails,
          listIds: selectedListIds
        })
      );
    } catch (error) {
      setPreviewOpen(false);
      toast.error(
        error instanceof Error ? error.message : "Could not build the preview."
      );
    } finally {
      setPreviewing(false);
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
      // A recurring send outlives the composer, so it becomes its own record
      // rather than a queued EmailJob. Attachments are not carried over: an
      // attachment row is claimed by a single EmailJob and can't be reused on
      // every occurrence.
      if (attachments.length > 0) {
        toast.error(
          "Recurring sends can't include attachments. Remove them or send once instead."
        );
        return;
      }

      setSending(true);
      try {
        const created = await api.createRecurringSend({
          organizationId,
          name: subject,
          to: toEmails,
          cc: ccEmails.length ? ccEmails : undefined,
          bcc: bccEmails.length ? bccEmails : undefined,
          listIds: selectedListIds.length ? selectedListIds : undefined,
          smtpConnectionId:
            smtpConnectionId === DEFAULT_SMTP ? undefined : smtpConnectionId,
          templateId: templateId === NO_TEMPLATE ? undefined : templateId,
          subject,
          html,
          cronExpression: cron,
          timezone: recurrence.timezone
        });
        if (draftId) {
          await api.deleteEmailDraft(draftId).catch(() => undefined);
        }
        // The schedule now lives on its own page, so the confirmation is also
        // the signpost to it — otherwise creating one is the last you see of it.
        toast.success(`Recurring send created: ${describeCron(cron)}.`, {
          action: {
            label: "View schedules",
            onClick: () => navigate("/campaigns/recurring")
          }
        });
        resetComposer();
        setDrafts(await api.listEmailDrafts(organizationId));
        void created;
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Unable to create the recurring send"
        );
      } finally {
        setSending(false);
      }
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

    // Captured before the composer resets, so the confirmation can say who it
    // went to rather than quoting a job id.
    const recipientSummary = listMemberEstimate > 0
      ? `about ${totalRecipients} people`
      : describeRecipientCount(totalRecipients);

    setSending(true);
    try {
      const result = await api.sendManualEmail({
        organizationId,
        to: toEmails,
        cc: ccEmails.length ? ccEmails : undefined,
        bcc: bccEmails.length ? bccEmails : undefined,
        listIds: selectedListIds.length ? selectedListIds : undefined,
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
      // The send was accepted — discard the working draft so it doesn't linger.
      if (draftId) {
        await api.deleteEmailDraft(draftId).catch(() => undefined);
      }
      if (scheduledAtIso) {
        toast.success(
          `Scheduled — sends ${formatSendTime(scheduledAtIso)} to ${recipientSummary}.`,
          {
            action: {
              label: "View outbox",
              onClick: () => navigate("/outbox")
            }
          }
        );
      } else {
        // Every send is queued now: the API answer means "accepted", not
        // "delivered". Confirm handoff immediately, then poll the job for the
        // real outcome below.
        toast.success(`Queued — sending to ${recipientSummary}.`, {
          action: {
            label: "View outbox",
            onClick: () => navigate("/outbox")
          }
        });
      }
      resetComposer();
      setDrafts(await api.listEmailDrafts(organizationId));
      // Surface per-recipient delivery status for the just-created job. For an
      // immediate send, keep polling until the worker settles the job (or we
      // give up) so the composer can report the actual outcome. Fire-and-forget
      // so the form unlocks right away; a failed poll is non-fatal.
      void pollDeliveryStatus(result.id, organizationId, {
        follow: !scheduledAtIso,
        recipientSummary
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't send the email."
      );
    } finally {
      setSending(false);
    }
  }

  const noSmtp = !loading && smtpConnections.length === 0;

  /*
    Revealed on request, or because there is something in there to see: a draft
    resumed with a Bcc, or an upload that has just landed. Without the second
    half of each condition the content would exist with nowhere to render.
  */
  const copyVisible =
    copyRevealed || ccEmails.length > 0 || bccEmails.length > 0;
  const attachmentsVisible = attachmentsRevealed || attachments.length > 0;

  return (
    <>
      <PageHeader
        title="Compose"
        description="Write and send a one-off email through your delivery pipeline."
        width="compose"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDraftsOpen(true)}
              disabled={!organizationId}
            >
              <FileText className="h-4 w-4" />
              Drafts{drafts.length ? ` (${drafts.length})` : ""}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void saveDraft(false)}
              disabled={!organizationId || savingDraft || !hasContent}
            >
              {savingDraft ? <Spinner /> : <Save className="h-4 w-4" />}
              Save draft
            </Button>
          </div>
        }
      />

      <PageContainer width="compose">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-touch w-full sm:h-control sm:w-field-name" />
            <Skeleton className="h-touch w-full sm:h-control sm:w-field-long" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          /*
            Two columns, both sized to their content rather than to the window:
            a 640px form column (§2) and a rail beside it that holds the send
            options for this message. Below `xl` the rail drops underneath, and
            on a phone every field inside collapses to the padded column's full
            width — the mobile inversion, which each field carries itself via
            its `width` prop.

            Neither the width nor the centring is set here: `width="compose"`
            on the container above is the single place both are stated, so the
            header's title and actions land on this cluster's two edges. It
            used to pin left, dumping every pixel the window gained on the
            right — 656px of it at 1920px.
          */
          <form
            onSubmit={send}
            className="grid gap-8 xl:grid-cols-[minmax(0,var(--content-form))_var(--content-rail)]"
          >
            <div className="min-w-0 space-y-6">
              {noSmtp ? (
                <div className="rounded-card border border-border bg-warn-bg px-4 py-3 text-ui leading-5 text-warn">
                  <p className="font-medium">No sending account yet</p>
                  <p className="mt-1">
                    Email can't go out until one is configured.{" "}
                    <Link
                      to="/settings/sending"
                      className="rounded-control font-medium underline underline-offset-2"
                    >
                      Add a sending account
                    </Link>
                    .
                  </p>
                </div>
              ) : null}

              <FormSections>
                <FormSection
                  title="Recipients"
                  description="Who this goes to, and the account it sends as."
                >
                  <Field className={fieldWidths.name}>
                    <Label htmlFor="from">From</Label>
                    <Select
                      value={smtpConnectionId}
                      onValueChange={setSMTPConnectionId}
                    >
                      <SelectTrigger id="from" width="name">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {/* Name the account the send will actually use, rather
                            than the word "default" on its own. */}
                        <SelectItem
                          value={DEFAULT_SMTP}
                          disabled={!loading && !defaultConnection}
                        >
                          {defaultConnection
                            ? `Default · ${describeConnection(defaultConnection)}`
                            : "No default sending account — pick one below"}
                        </SelectItem>
                        {smtpConnections.map((connection) => (
                          <SelectItem key={connection.id} value={connection.id}>
                            <span className="flex items-center gap-2">
                              {describeConnection(connection)}
                              {connection.isDefault ? (
                                <Badge variant="secondary" className="font-normal">
                                  Default
                                </Badge>
                              ) : null}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <RecipientField
                    id="to"
                    label="To"
                    emails={toEmails}
                    onChange={setToEmails}
                    suggestions={recipientSuggestions}
                  />

                  {selectedLists.length > 0 ? (
                    <div className="flex flex-wrap gap-field">
                      {selectedLists.map((list) => (
                        <Badge key={list.id} variant="outline" className="gap-1 pr-1">
                          {list.name} ({list._count?.contacts ?? 0})
                          <button
                            type="button"
                            aria-label={`Remove ${list.name}`}
                            onClick={() =>
                              setSelectedListIds((current) =>
                                current.filter((id) => id !== list.id)
                              )
                            }
                            className={cn(
                              "relative flex h-4 w-4 items-center justify-center rounded-pill",
                              "text-text-tertiary transition-colors duration-fast ease-out hover:text-err",
                              "after:absolute after:left-1/2 after:top-1/2 after:h-touch after:w-touch",
                              "after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] sm:after:hidden"
                            )}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setContactPickerOpen(true)}
                    >
                      <Users className="h-4 w-4" />
                      Add contacts
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setListPickerOpen(true)}
                    >
                      <Users className="h-4 w-4" />
                      Add list
                    </Button>
                    {/*
                      The reveal disappears once the fields are on screen, the
                      way every mail client does it: a "hide" that refuses to
                      hide because you typed an address into it is worse than
                      no button at all.
                    */}
                    {copyVisible ? null : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-expanded={false}
                        aria-controls="cc"
                        onClick={() => setCopyRevealed(true)}
                      >
                        Cc / Bcc
                      </Button>
                    )}
                  </div>

                  {copyVisible ? (
                    <>
                      <RecipientField
                        id="cc"
                        label="Cc"
                        emails={ccEmails}
                        onChange={setCcEmails}
                        suggestions={recipientSuggestions}
                      />
                      <RecipientField
                        id="bcc"
                        label="Bcc"
                        emails={bccEmails}
                        onChange={setBccEmails}
                        suggestions={recipientSuggestions}
                      />
                    </>
                  ) : null}

                  <Field className={fieldWidths.long}>
                    <Label htmlFor="subject">Subject</Label>
                    <Input
                      id="subject"
                      width="long"
                      value={subject}
                      onChange={(event) => setSubject(event.target.value)}
                      placeholder="Subject line"
                    />
                  </Field>
                </FormSection>

                <FormSection
                  title="Message"
                  action={
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => void openPreview()}
                      disabled={previewing}
                    >
                      {previewing ? <Spinner /> : <Eye className="h-4 w-4" />}
                      Preview
                    </Button>
                  }
                >
                  <Field className="space-y-4">
                    <Select value={templateId} onValueChange={selectTemplate}>
                      <SelectTrigger
                        id="template"
                        width="name"
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

                    {/* The editor is the one control that legitimately fills
                        the form column — prose has no natural width. */}
                    <BodyEditor
                      value={html}
                      onChange={setHtml}
                      placeholder="Write your email…"
                      showVariables={false}
                      onUploadImage={uploadInlineImage}
                    />
                  </Field>

                  {/*
                    The file input stays mounted whether or not the tray is
                    revealed: it is the hidden control the button drives, and
                    unmounting it would break the picker mid-upload.
                  */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    aria-label="Add attachments"
                    className="hidden"
                    onChange={handleFileSelect}
                  />

                  {attachmentsVisible ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <Label>Attachments</Label>
                        <Button
                          type="button"
                          variant="secondary"
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
                      </div>
                      {attachments.length > 0 ? (
                        <ul className="space-y-field">
                          {attachments.map((attachment) => (
                            <li
                              key={attachment.id}
                              className="flex min-h-touch items-center gap-2 rounded-control border border-border px-3 py-2 text-ui sm:min-h-0"
                            >
                              <Paperclip className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                              <span className="min-w-0 flex-1 truncate text-text">
                                {attachment.filename}
                              </span>
                              <span
                                data-numeric
                                className="shrink-0 text-meta text-text-tertiary"
                              >
                                {formatBytes(attachment.size)}
                              </span>
                              <button
                                type="button"
                                aria-label={`Remove ${attachment.filename}`}
                                onClick={() =>
                                  void removeAttachment(attachment.id)
                                }
                                className={cn(
                                  "relative flex h-5 w-5 shrink-0 items-center justify-center rounded-control",
                                  "text-text-tertiary transition-colors duration-fast ease-out hover:text-err",
                                  "after:absolute after:left-1/2 after:top-1/2 after:h-touch after:w-touch",
                                  "after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] sm:after:hidden"
                                )}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-meta text-text-tertiary">
                          Nothing attached yet.
                        </p>
                      )}
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-expanded={false}
                      className="-ml-3"
                      onClick={() => setAttachmentsRevealed(true)}
                    >
                      <Paperclip className="h-4 w-4" />
                      Attachments
                    </Button>
                  )}
                </FormSection>
              </FormSections>
            </div>

            {/*
              The rail holds the options for *this* message and nothing else.

              It used to also list every recurring send in the organization, in
              a card that grew its own scrollbar — §2's named example of the
              rule it broke. That list is a page now (/campaigns/recurring), so
              what is left here is short enough to sit still: nothing in this
              column sets an overflow or a height, so it cannot scroll on its
              own at any width.
            */}
            <div className="min-w-0 space-y-6 xl:sticky xl:top-6 xl:self-start">
              <Card className="space-y-4 p-card">
                <div>
                  <h2 className="text-section font-semibold text-text">
                    Send options
                  </h2>
                  <p className="mt-1 text-ui leading-5 text-text-secondary">
                    Send now, schedule it for later, or repeat it on a schedule.
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
                />
                {recurring && attachments.length > 0 ? (
                  <p className="text-meta leading-5 text-err">
                    Recurring sends can&apos;t include attachments — each
                    occurrence would need its own copy.
                  </p>
                ) : null}

                {/*
                  The running tally lives with the button that acts on it —
                  a list contributes an estimate, so it is marked approximate.
                */}
                <p className="text-ui leading-5 text-text-secondary">
                  {totalRecipients === 0
                    ? "No recipients yet — add people in the To field."
                    : `Sending to ${listMemberEstimate > 0 ? "~" : ""}${totalRecipients} ${
                        totalRecipients === 1 ? "recipient" : "recipients"
                      }. Duplicates are removed.`}
                </p>

                {/* The one primary button in the view (§3). */}
                <Button
                  type="submit"
                  className="w-full"
                  disabled={sending || noSmtp || !organizationId}
                >
                  {sending ? <Spinner /> : <Send className="h-4 w-4" />}
                  {recurring
                    ? "Create recurring send"
                    : scheduleForLater
                      ? "Schedule email"
                      : "Send email"}
                </Button>
                {/*
                  "Saved" and "saved on this device" are not the same promise,
                  and on a phone the difference is the one that matters — so the
                  pending state says which, rather than letting an unsynced
                  draft wear the same reassuring line as a synced one.
                */}
                {pendingLocally ? (
                  <p className="text-center text-meta text-warn">
                    Saved on this device — syncs when you&rsquo;re back online
                  </p>
                ) : lastSavedAt ? (
                  <p className="text-center text-meta text-text-tertiary">
                    Draft saved
                  </p>
                ) : null}

                {/*
                  Where the list that used to fill this rail went. It sits
                  under the repeat switch because that is the control it
                  explains: turning it on adds a row over there.
                */}
                <Link
                  to="/campaigns/recurring"
                  className={cn(
                    "-mx-1 flex min-h-touch items-center justify-between gap-2 rounded-control px-1",
                    "text-ui font-medium text-text-secondary sm:min-h-0 sm:py-1",
                    "transition-colors duration-fast ease-out hover:text-text"
                  )}
                >
                  Manage recurring sends
                  <ArrowUpRight className="h-4 w-4 shrink-0" />
                </Link>
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
      </PageContainer>

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
            // §3: no full-width bordered box around a "you have nothing yet".
            <EmptyState
              title="No saved drafts yet"
              description="Anything you start writing here is kept automatically."
            />
          ) : (
            // scroll-exception: a dialog, which §2 names alongside dropdowns.
            // Radix freezes the document while it is open, so this is still the
            // only scrollbar on screen.
            <div className="max-h-80 space-y-field overflow-auto">
              {drafts.map((draft) => (
                <div
                  key={draft.id}
                  className="flex items-center gap-2 rounded-card border border-border p-3 transition-colors duration-fast ease-out hover:bg-surface-sunken"
                >
                  <button
                    type="button"
                    onClick={() => void loadDraft(draft)}
                    className="min-h-touch min-w-0 flex-1 rounded-control text-left sm:min-h-0"
                  >
                    <div className="truncate text-body font-medium text-text">
                      {draft.subject || "(no subject)"}
                    </div>
                    <div className="truncate text-meta text-text-tertiary">
                      {draft.to.length || draft.listIds.length
                        ? `${draft.to.join(", ") || `${draft.listIds.length} list(s)`}`
                        : "No recipients"}
                    </div>
                  </button>
                  <IconButton
                    label={`Delete ${draft.subject || "this draft"}`}
                    variant="destructive"
                    onClick={() => setDeleteDraftTarget(draft)}
                  >
                    <Trash2 />
                  </IconButton>
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

      <ConfirmDialog
        open={pendingTemplateId !== null}
        onOpenChange={(open) => !open && setPendingTemplateId(null)}
        title="Use this template?"
        description="It replaces the subject and message you have written. Your saved template isn't changed."
        confirmLabel="Use template"
        destructive={false}
        onConfirm={() => {
          if (pendingTemplateId) {
            applyTemplate(pendingTemplateId);
          }
          setPendingTemplateId(null);
        }}
      />

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Preview</DialogTitle>
            <DialogDescription>
              Rendered by the send pipeline — this is the message your recipients
              receive, with tracked links in place.
            </DialogDescription>
          </DialogHeader>
          {previewing ? (
            <div className="flex items-center gap-2 py-12 text-ui text-text-secondary">
              <Spinner />
              Rendering…
            </div>
          ) : preview ? (
            <div className="space-y-3">
              <dl className="space-y-1 rounded-control border border-border bg-surface-sunken px-3 py-2 text-ui">
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-text-tertiary">Subject</dt>
                  <dd className="min-w-0 font-medium text-text">
                    {preview.subject || "(no subject)"}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-text-tertiary">To</dt>
                  <dd className="min-w-0 break-words text-text">
                    {preview.recipients.to.join(", ") || "—"}
                  </dd>
                </div>
                {preview.recipients.total > preview.recipients.to.length ? (
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-text-tertiary">Also</dt>
                    <dd className="min-w-0 text-text-secondary">
                      {preview.recipients.cc.length} cc,{" "}
                      {preview.recipients.bcc.length} bcc
                    </dd>
                  </div>
                ) : null}
              </dl>
              <EmailPreviewFrame
                html={preview.html}
                data-testid="composer-preview"
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
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
  failed: "destructive",
  suppressed: "outline"
};

// Per-recipient delivery status shown after a send. A manual send is one
// EmailJob per To recipient (grouped server-side), so each row reflects its own
// job's outcome; engagement counts aggregate across the whole send.
function DeliveryStatusCard({
  status,
  onDismiss
}: {
  status: ManualEmailDeliveryStatus;
  onDismiss: () => void;
}) {
  return (
    <Card className="space-y-4 p-card" data-testid="delivery-status">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-section font-semibold text-text">Delivery status</h2>
        <IconButton
          label="Dismiss delivery status"
          size="sm"
          onClick={onDismiss}
        >
          <X />
        </IconButton>
      </div>

      <div className="space-y-field">
        {status.recipients.map((recipient) => (
          <div
            key={`${recipient.field}-${recipient.email}`}
            className="flex items-center justify-between gap-2 text-ui"
          >
            <span className="min-w-0 flex-1 truncate text-text">
              <span className="mr-field text-meta uppercase tracking-eyebrow text-text-tertiary">
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

      {/* Engagement aggregates across the whole send — tabular figures so the
          four numbers line up as a block rather than jittering. */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 text-ui">
        <div className="flex justify-between gap-2">
          <dt className="text-text-secondary">Opens</dt>
          <dd data-numeric className="text-text">
            {status.opens}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-text-secondary">Clicks</dt>
          <dd data-numeric className="text-text">
            {status.clicks}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-text-secondary">Bounces</dt>
          <dd data-numeric className="text-text">
            {status.bounces}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-text-secondary">Complaints</dt>
          <dd data-numeric className="text-text">
            {status.complaints}
          </dd>
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
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
          <Input
            identifier
            type="search"
            placeholder="Search contacts…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-control"
          />
        </div>
        {/* scroll-exception: inside a dialog (§2). */}
        <div className="max-h-72 space-y-1 overflow-auto rounded-control border border-border p-2">
          {filtered.length === 0 ? (
            <p className="px-1 py-2 text-ui text-text-secondary">
              No contacts found.
            </p>
          ) : (
            filtered.map((contact) => (
              <label
                key={contact.id}
                // The whole row is the tap target, and it is 44px tall on a
                // phone — a 16px checkbox is not something a thumb can hit.
                className="flex min-h-touch cursor-pointer items-center gap-2 rounded-control px-2 py-field text-body transition-colors duration-fast ease-out hover:bg-surface-sunken sm:min-h-0"
              >
                <Checkbox
                  checked={selected.includes(contact.id)}
                  onCheckedChange={() => toggle(contact.id)}
                  aria-label={`Select ${contact.email}`}
                />
                <span className="truncate text-text">{contact.email}</span>
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
        {/* scroll-exception: inside a dialog (§2). */}
        <div className="max-h-72 space-y-1 overflow-auto rounded-control border border-border p-2">
          {lists.length === 0 ? (
            <p className="px-1 py-2 text-ui text-text-secondary">
              No contact lists yet.
            </p>
          ) : (
            lists.map((list) => (
              <label
                key={list.id}
                className="flex min-h-touch cursor-pointer items-center gap-2 rounded-control px-2 py-field text-body transition-colors duration-fast ease-out hover:bg-surface-sunken sm:min-h-0"
              >
                <Checkbox
                  checked={draft.includes(list.id)}
                  onCheckedChange={() => toggle(list.id)}
                  aria-label={`Select ${list.name}`}
                />
                <span className="flex-1 truncate text-text">{list.name}</span>
                <span data-numeric className="text-meta text-text-tertiary">
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
