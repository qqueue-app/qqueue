import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Inbox as InboxIcon,
  Mail,
  MailPlus,
  Paperclip,
  RefreshCw,
  Reply,
  Send,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "../components/EmptyState.js";
import { InboundHtmlFrame } from "../components/InboundHtmlFrame.js";
import { ConnectInboxDialog } from "../components/inbox/ConnectInboxDialog.js";
import {
  AttachmentPreviewDialog,
  attachmentPreviewKind,
  downloadBlob,
} from "../components/inbox/AttachmentPreviewDialog.js";
import {
  api,
  type InboundAttachment,
  type InboundMessage,
} from "../lib/api.js";
import { formatFullDate, formatMailDate, formatBytes } from "../lib/format.js";
import { useInboundInlineImages } from "../lib/inbound-inline-images.js";
import { qk } from "../lib/query-client.js";
import { useApiMutation, useOrgQuery } from "../lib/use-api.js";
import { useSession } from "../lib/session-context.js";
import { cn } from "../lib/utils.js";
import { Avatar } from "../components/ui/avatar.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { IconButton } from "../components/ui/icon-button.js";
import { Input } from "../components/ui/input.js";
import { Spinner } from "../components/ui/spinner.js";
import { Textarea } from "../components/ui/textarea.js";
import { Hint } from "../components/ui/tooltip.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";

type ReadFilter = "all" | "unread" | "read";

interface ConversationThread {
  threadKey: string;
  messages: InboundMessage[];
  latestMessage: InboundMessage;
  senderName: string;
  senderEmail: string;
  subject: string;
  unreadCount: number;
}

function senderName(message: InboundMessage) {
  return message.fromName || message.fromEmail;
}

function senderLabel(message: InboundMessage) {
  return message.fromName
    ? `${message.fromName} <${message.fromEmail}>`
    : message.fromEmail;
}

function snippet(message: InboundMessage) {
  const text = message.text?.replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 180);
  if (!message.html) return "No preview available";
  // HTML-only message: derive a preview instead of showing a placeholder. This
  // is a list snippet rendered as a plain text node, never as markup, so
  // stripping tags crudely is enough — script/style contents are dropped first
  // so their source doesn't surface as "preview text".
  const stripped = message.html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  return stripped ? stripped.slice(0, 180) : "No preview available";
}

function threadKeyForMessage(message: InboundMessage) {
  return (
    message.references[0] ??
    message.inReplyTo ??
    message.emailJob?.messageId ??
    message.messageId
  );
}

function compareMessages(a: InboundMessage, b: InboundMessage) {
  const delta =
    new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime();
  return delta !== 0 ? delta : a.id.localeCompare(b.id);
}

function buildConversationThreads(messages: InboundMessage[]) {
  const threads = new Map<string, ConversationThread>();

  for (const message of messages) {
    const threadKey = threadKeyForMessage(message);
    const current = threads.get(threadKey);

    if (!current) {
      threads.set(threadKey, {
        threadKey,
        messages: [message],
        latestMessage: message,
        senderName: senderName(message),
        senderEmail: message.fromEmail,
        subject: message.subject || "(no subject)",
        unreadCount: message.readAt ? 0 : 1,
      });
      continue;
    }

    current.messages.push(message);
    current.messages.sort(compareMessages);
    current.latestMessage =
      current.messages[current.messages.length - 1] ?? current.latestMessage;
    current.senderName = senderName(current.latestMessage);
    current.senderEmail = current.latestMessage.fromEmail;
    current.subject = current.latestMessage.subject || current.subject;
    current.unreadCount += message.readAt ? 0 : 1;
  }

  return [...threads.values()]
    .sort(
      (a, b) =>
        new Date(b.latestMessage.receivedAt).getTime() -
        new Date(a.latestMessage.receivedAt).getTime()
    )
    .map((thread) => ({
      ...thread,
      messages: [...thread.messages].sort(compareMessages),
    }));
}

/**
 * The inbox — the app's home screen.
 *
 * One screen at a time, the way Gmail does it: the conversation list owns the
 * full width of the page, and opening a conversation *replaces* it with the
 * reader instead of squeezing both into a split. The two-pane version put the
 * list in a 22rem rail and the message in whatever was left, which meant a
 * desktop reader narrower than the phone one and a list too cramped to show a
 * sender, a subject and its preview on one line. Now the row reads like a mail
 * client's — sender, subject, preview, date across a single line above `sm`,
 * stacked below it — and the message gets the whole measure.
 *
 * Nothing is open until it is tapped: there is no auto-selected first
 * conversation, so arriving at the inbox never marks a message read.
 */
export function Inbox() {
  const { currentOrganizationId: organizationId } = useSession();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [accountFilter, setAccountFilter] = useState("all");
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  /*
    The conversation being read, captured at the moment it was opened.

    Held as the thread itself rather than as a key into the list, because the
    list moves underneath it: opening a conversation marks it read, which
    refetches, and under the "unread" filter that drops the very thread being
    read. A key would resolve to nothing and slam the reader shut mid-sentence.
    The live thread is preferred whenever it is still there, so a reply landing
    in the open conversation still appears.
  */
  const [openedThread, setOpenedThread] = useState<ConversationThread | null>(
    null
  );
  const [connectOpen, setConnectOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    attachment: InboundAttachment;
    blob: Blob;
  } | null>(null);

  const accountsQuery = useOrgQuery(
    organizationId,
    qk.inboxAccounts(organizationId ?? ""),
    (id) => api.listInboxAccounts(id)
  );

  const messagesQuery = useOrgQuery(
    organizationId,
    qk.inboundMessages(organizationId ?? "", {
      q: submittedSearch,
      read: readFilter,
    }),
    (id) =>
      api.listInboundMessages({
        organizationId: id,
        q: submittedSearch || undefined,
        read: readFilter,
      }),
    {
      // Mail arrives on the worker's IMAP cadence; refetching while the tab is
      // open keeps the list live without anyone pressing refresh.
      refetchInterval: 60_000,
    }
  );

  const accounts = useMemo(
    () => accountsQuery.data ?? [],
    [accountsQuery.data]
  );
  const messages = useMemo(
    () => messagesQuery.data?.data ?? [],
    [messagesQuery.data]
  );

  const filteredMessages = useMemo(
    () =>
      accountFilter === "all"
        ? messages
        : messages.filter(
            (message) => message.inboxAccountId === accountFilter
          ),
    [messages, accountFilter]
  );
  const threads = useMemo(
    () => buildConversationThreads(filteredMessages),
    [filteredMessages]
  );
  const selectedThread = useMemo(
    () =>
      openedThread
        ? (threads.find(
            (thread) => thread.threadKey === openedThread.threadKey
          ) ?? openedThread)
        : null,
    [threads, openedThread]
  );
  const unreadCount = filteredMessages.filter(
    (message) => !message.readAt
  ).length;

  // Only the open thread's inline parts are fetched — the list renders no
  // bodies, so downloading blobs for every message would be wasted bandwidth.
  const inlineImages = useInboundInlineImages(
    useMemo(() => selectedThread?.messages ?? [], [selectedThread]),
    organizationId ?? null
  );

  const markRead = useApiMutation(
    (input: { id: string; read: boolean }) =>
      api.markInboundMessageRead(input.id, {
        organizationId: organizationId as string,
        read: input.read,
      }),
    {
      errorMessage: "Couldn't update that message.",
      invalidates: () => [
        qk.inboundMessages(organizationId ?? "", {
          q: submittedSearch,
          read: readFilter,
        }),
        // The nav badge reads its own query; keep the two in step.
        qk.inboxUnreadCount(organizationId ?? ""),
      ],
    }
  );

  const removeAccount = useApiMutation(
    (accountId: string) =>
      api.deleteInboxAccount(accountId, organizationId as string),
    {
      successMessage: "Mailbox disconnected.",
      errorMessage: "Couldn't disconnect that mailbox.",
      invalidates: [qk.inboxAccounts(organizationId ?? "")],
      onSuccess: () => setAccountFilter("all"),
    }
  );

  const reply = useApiMutation(
    (input: { messageId: string; subject: string; text: string }) =>
      api.replyToInboundMessage(input.messageId, {
        organizationId: organizationId as string,
        subject: input.subject,
        text: input.text,
      }),
    {
      successMessage: "Reply sent.",
      errorMessage: "Couldn't send that reply.",
      onSuccess: () => {
        setReplyBody("");
        void queryClient.invalidateQueries({ queryKey: ["inbound-messages"] });
      },
    }
  );

  function openThread(thread: ConversationThread) {
    setOpenedThread(thread);
    // Opening a conversation reads every message in it, the way a mail client
    // does — leaving older messages in a thread unread would keep the badge lit
    // with nothing left to click.
    thread.messages
      .filter((message) => !message.readAt)
      .forEach((message) => markRead.mutate({ id: message.id, read: true }));
  }

  // Deep link from a push notification: /inbox?message=<id>. Open the thread
  // that message belongs to, then drop the parameter so a later refresh doesn't
  // yank the reader back to an old message.
  useEffect(() => {
    const target = searchParams.get("message");
    if (!target || messages.length === 0) return;
    const message = messages.find((candidate) => candidate.id === target);
    if (!message) return;
    const thread = threads.find(
      (candidate) => candidate.threadKey === threadKeyForMessage(message)
    );
    if (thread) openThread(thread);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("message");
        return next;
      },
      { replace: true }
    );
  }, [searchParams, messages, threads, setSearchParams]);

  useEffect(() => {
    setReplyBody("");
  }, [openedThread?.threadKey]);

  // Escape leaves the conversation, the way it does in a mail client. Skipped
  // while an overlay is up — there the key belongs to the dialog — and while
  // the caret is in a field, where it belongs to whatever is being typed.
  useEffect(() => {
    if (!openedThread || connectOpen || preview) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, [contenteditable='true']")) return;
      setOpenedThread(null);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openedThread, connectOpen, preview]);

  /**
   * Open an attachment the way a mail client does: show it in place when it is
   * something the browser can render safely, and only fall back to saving it to
   * disk for formats it can't (documents, archives, anything scriptable).
   *
   * Either way the bytes come over the authenticated download route — inbound
   * files are never exposed publicly, so the file can't just be linked to.
   */
  async function openAttachment(messageId: string, file: InboundAttachment) {
    if (!organizationId) return;
    setOpeningId(file.id);
    try {
      const blob = await api.downloadInboundAttachment({
        messageId,
        attachmentId: file.id,
        organizationId,
      });
      if (attachmentPreviewKind(file.contentType)) {
        setPreview({ attachment: file, blob });
      } else {
        downloadBlob(blob, file.filename);
      }
    } catch {
      toast.error("Couldn't open that file.");
    } finally {
      setOpeningId(null);
    }
  }

  function submitReply(event: FormEvent) {
    event.preventDefault();
    if (!selectedThread || !replyBody.trim()) return;
    reply.mutate({
      messageId: selectedThread.latestMessage.id,
      subject: selectedThread.latestMessage.subject || "(no subject)",
      text: replyBody,
    });
  }

  const loading = accountsQuery.isPending || messagesQuery.isPending;
  // With a single mailbox there is no filter to pick it with, so treat it as
  // selected — otherwise its status and its Disconnect control would be
  // unreachable for the most common setup of all.
  const selectedAccount =
    accounts.find((account) => account.id === accountFilter) ??
    (accounts.length === 1 ? accounts[0] : undefined);

  /*
    The document is the only scroll container (§2), so nothing here sets a
    height or an overflow: the screen grows to its content and the page
    scrolls, with each header held in place by `sticky` at the offset the shell
    publishes (which already accounts for the notch and the tablet top bar).

    `mx-auto max-w-page` goes on the inner wrappers rather than on the screen
    itself, so every rule and hairline still runs edge to edge while the rows
    and the message sit on the same measure as the rest of the app.
  */
  return (
    <div className="flex min-h-0 flex-col">
      {selectedThread ? (
        /* ------------------------------------------------------------ reader */
        <>
          <header className="sticky top-sticky-top z-10 border-b border-border bg-surface">
            <div className="mx-auto w-full max-w-page px-4 py-3 sm:px-6">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setOpenedThread(null)}
                  className="-ml-1 inline-flex min-h-touch items-center gap-field rounded-control px-1 text-ui font-medium text-text-secondary transition-colors duration-fast ease-out hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Inbox
                </button>

                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <IconButton
                    label="Mark as unread"
                    onClick={() => {
                      markRead.mutate({
                        id: selectedThread.latestMessage.id,
                        read: false,
                      });
                      // Back to the list, the way every mail client does it —
                      // otherwise the conversation you just marked unread is
                      // still open, and closing it later would mark it read.
                      setOpenedThread(null);
                    }}
                  >
                    <Mail />
                  </IconButton>
                  <IconButton
                    label="Reply"
                    onClick={() => {
                      document
                        .getElementById("inbox-reply")
                        ?.scrollIntoView({ behavior: "smooth" });
                      document.getElementById("inbox-reply")?.focus();
                    }}
                  >
                    <Reply />
                  </IconButton>
                </div>
              </div>

              <div className="mt-2 min-w-0">
                <h2 className="text-title font-semibold text-text">
                  {selectedThread.subject}
                </h2>
                <p className="mt-1 truncate text-ui text-text-secondary">
                  {selectedThread.senderName} · {selectedThread.senderEmail}
                </p>
              </div>
            </div>
          </header>

          <div className="mx-auto w-full max-w-page space-y-4 px-4 py-4 sm:px-6 sm:py-6">
            {selectedThread.messages.map((message) => (
              <article
                key={message.id}
                className="rounded-card border border-border bg-surface p-4 shadow-card"
              >
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar name={senderName(message)} size="sm" />
                    <div className="min-w-0">
                      <div className="truncate text-ui font-semibold text-text">
                        {senderLabel(message)}
                      </div>
                      <div
                        className="text-meta text-text-tertiary"
                        data-numeric
                      >
                        {formatFullDate(message.receivedAt)}
                      </div>
                    </div>
                  </div>
                  {message.emailJob ? (
                    <Hint
                      label={`This is a reply to the email "${message.emailJob.subject}" that you sent`}
                    >
                      <Badge variant="outline" className="cursor-help">
                        Reply to your email
                      </Badge>
                    </Hint>
                  ) : null}
                </div>

                {/*
                  Prefer the HTML part — formatted mail (tables especially)
                  reads badly as the flattened text/plain alternative.
                */}
                {message.html ? (
                  <InboundHtmlFrame
                    html={message.html}
                    /*
                      Remote images load without an opt-in. Most mail is
                      image-heavy and a blocked-image prompt on every message
                      made the inbox unreadable; the tradeoff is that opening
                      a message can fire the sender's tracking pixel, exactly
                      as it does in Gmail's default configuration. The frame
                      still refuses scripts, frames and network fetches — only
                      img-src is widened.
                    */
                    showRemoteContent
                    inlineImages={inlineImages[message.id]}
                    title={`Message from ${senderLabel(message)}`}
                  />
                ) : (
                  <div className="whitespace-pre-wrap text-body leading-6 text-text">
                    {message.text || "This message has no body."}
                  </div>
                )}

                {/*
                  Attached parts. Inline parts (cid: images the sender meant
                  to render in the body) are filtered out so a signature logo
                  doesn't look like an attachment.
                */}
                {(message.attachments ?? []).filter((file) => !file.isInline)
                  .length > 0 ? (
                  <div className="mt-4 border-t border-border pt-3">
                    <div className="mb-2 text-meta font-medium uppercase tracking-eyebrow text-text-tertiary">
                      Attachments
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(message.attachments ?? [])
                        .filter((file) => !file.isInline)
                        .map((file) => (
                          <Hint
                            key={file.id}
                            label={`${
                              attachmentPreviewKind(file.contentType)
                                ? "Open"
                                : "Download"
                            } ${file.filename} (${formatBytes(file.size)})`}
                          >
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={openingId === file.id}
                              onClick={() =>
                                void openAttachment(message.id, file)
                              }
                              className="h-auto gap-2 py-field"
                            >
                              {openingId === file.id ? (
                                <Spinner className="h-3.5 w-3.5" />
                              ) : (
                                <Paperclip className="h-3.5 w-3.5" />
                              )}
                              <span className="max-w-cell truncate">
                                {file.filename}
                              </span>
                              <span
                                className="text-meta text-text-tertiary"
                                data-numeric
                              >
                                {formatBytes(file.size)}
                              </span>
                            </Button>
                          </Hint>
                        ))}
                    </div>
                  </div>
                ) : null}
              </article>
            ))}

            <form
              className="rounded-card border border-border bg-surface p-4 shadow-card"
              onSubmit={submitReply}
            >
              <Textarea
                id="inbox-reply"
                value={replyBody}
                onChange={(event) => setReplyBody(event.target.value)}
                placeholder={`Reply to ${selectedThread.senderName}…`}
                rows={3}
                className="resize-y"
                aria-label={`Reply to ${selectedThread.senderName}`}
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-meta text-text-tertiary">
                  Sends from the mailbox this arrived in.
                </p>
                <Button
                  type="submit"
                  disabled={reply.isPending || !replyBody.trim()}
                >
                  {reply.isPending ? <Spinner /> : <Send className="h-4 w-4" />}
                  Send
                </Button>
              </div>
            </form>
          </div>
        </>
      ) : (
        /* -------------------------------------------------------------- list */
        <>
          <header className="sticky top-sticky-top z-10 border-b border-border bg-surface">
            <div className="mx-auto w-full max-w-page px-4 pb-3 pt-4 sm:px-6">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h1 className="text-section font-semibold text-text">
                    Inbox
                  </h1>
                  <p className="text-meta text-text-tertiary" data-numeric>
                    {unreadCount > 0
                      ? `${unreadCount} unread of ${filteredMessages.length}`
                      : `${filteredMessages.length} message${filteredMessages.length === 1 ? "" : "s"}`}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <IconButton
                    label="Check for new mail"
                    onClick={() => {
                      void queryClient.invalidateQueries({
                        queryKey: ["inbound-messages"],
                      });
                    }}
                    disabled={messagesQuery.isFetching}
                  >
                    <RefreshCw
                      className={cn(messagesQuery.isFetching && "animate-spin")}
                    />
                  </IconButton>
                  <IconButton
                    label="Connect a mailbox"
                    onClick={() => setConnectOpen(true)}
                    disabled={!organizationId}
                  >
                    <MailPlus />
                  </IconButton>
                </div>
              </div>

              {/*
                Search, filters and the mailbox status share one wrapping row
                now that the list owns the full width. In the old 22rem rail
                they had to stack: a segmented control beside a mailbox picker
                put both below the 44px touch minimum (§5). They still wrap to
                their own lines on a phone, where the search box goes full
                width and the rest follows underneath.
              */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <form
                  className="w-full sm:w-auto"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setSubmittedSearch(search.trim());
                  }}
                >
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    onBlur={() => setSubmittedSearch(search.trim())}
                    identifier
                    placeholder="Search mail"
                    aria-label="Search mail"
                    type="search"
                    width="search"
                  />
                </form>

                <div className="flex rounded-control border border-border bg-surface-sunken p-1">
                  {(["all", "unread", "read"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setReadFilter(value)}
                      aria-pressed={readFilter === value}
                      className={cn(
                        "min-h-touch rounded-control px-3 text-ui font-medium capitalize transition-colors duration-fast ease-out sm:min-h-0 sm:py-field",
                        readFilter === value
                          ? "bg-surface text-text shadow-card"
                          : "text-text-secondary hover:text-text"
                      )}
                    >
                      {value}
                    </button>
                  ))}
                </div>

                {accounts.length > 1 ? (
                  <Select value={accountFilter} onValueChange={setAccountFilter}>
                    <SelectTrigger
                      aria-label="Filter by mailbox"
                      className="w-field-choice"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All mailboxes</SelectItem>
                      {accounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}

                {selectedAccount ? (
                  <div className="flex min-w-0 items-center gap-2 text-meta text-text-tertiary sm:ml-auto">
                    <Badge variant="outline" className="text-meta">
                      {selectedAccount.status}
                    </Badge>
                    <span className="truncate">
                      Synced {formatFullDate(selectedAccount.lastSyncedAt)}
                    </span>
                    <IconButton
                      label={`Disconnect ${selectedAccount.email}`}
                      size="sm"
                      variant="destructive"
                      onClick={() => removeAccount.mutate(selectedAccount.id)}
                    >
                      <Trash2 />
                    </IconButton>
                  </div>
                ) : null}
              </div>
            </div>
          </header>

          <div className="mx-auto w-full max-w-page">
            {loading ? (
              <div className="flex h-40 items-center justify-center">
                <Spinner />
              </div>
            ) : accounts.length === 0 ? (
              <EmptyState
                icon={MailPlus}
                title="No mailbox connected"
                description="Connect a mailbox and replies to your emails will show up here."
                action={
                  <Button
                    variant="secondary"
                    onClick={() => setConnectOpen(true)}
                  >
                    <MailPlus className="h-4 w-4" />
                    Connect a mailbox
                  </Button>
                }
              />
            ) : threads.length === 0 ? (
              <EmptyState
                icon={InboxIcon}
                title={
                  submittedSearch ? "Nothing matched" : "No conversations yet"
                }
                description={
                  submittedSearch
                    ? "Try a different search, or clear it to see everything."
                    : "Replies will appear here once your mailbox finishes syncing."
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {threads.map((thread) => {
                  const unread = thread.unreadCount > 0;
                  const hasAttachment = thread.messages.some((message) =>
                    message.attachments?.some((file) => !file.isInline)
                  );
                  return (
                    <li key={thread.threadKey}>
                      {/*
                        One row of markup for both layouts, reflowed by wrapping
                        rather than rendered twice: `order` puts the date second
                        on a phone (beside the sender) and last above `sm`, and
                        the subject block's `w-full` is what forces the wrap
                        below `sm` and stops forcing it above.
                      */}
                      <button
                        type="button"
                        onClick={() => openThread(thread)}
                        className={cn(
                          "relative flex min-h-touch w-full items-start gap-3 px-4 py-3 text-left transition-shadow duration-fast ease-out hover:z-10 hover:bg-surface hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:items-center sm:gap-4 sm:px-6",
                          // Unread mail sits on white while read mail sinks
                          // into the page. That is the signal that survives
                          // scanning a full screen of rows, which a weight
                          // change alone does not.
                          unread ? "bg-surface" : "bg-transparent"
                        )}
                      >
                        {unread ? (
                          <>
                            <span className="sr-only">Unread</span>
                            <span
                              aria-hidden
                              className="mt-4 h-2 w-2 shrink-0 rounded-pill bg-primary sm:mt-0"
                            />
                          </>
                        ) : (
                          // Holds the dot's column so read and unread rows
                          // start their avatars on the same vertical line.
                          <span aria-hidden className="h-2 w-2 shrink-0" />
                        )}

                        <Avatar name={thread.senderName} size="md" />

                        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span
                            className={cn(
                              "order-1 min-w-0 flex-1 truncate text-ui sm:w-list-sender sm:flex-none",
                              unread
                                ? "font-semibold text-text"
                                : "text-text-secondary"
                            )}
                          >
                            {thread.senderName}
                            {thread.messages.length > 1 ? (
                              <span
                                className="ml-1 font-text text-text-tertiary"
                                data-numeric
                              >
                                {thread.messages.length}
                              </span>
                            ) : null}
                          </span>

                          <div className="order-3 flex w-full min-w-0 flex-col gap-1 sm:order-2 sm:w-auto sm:flex-1 sm:flex-row sm:items-baseline sm:gap-2">
                            <span
                              className={cn(
                                "truncate text-ui text-text sm:max-w-cell-lg sm:shrink-0",
                                unread && "font-semibold"
                              )}
                            >
                              {thread.subject}
                            </span>
                            <p className="truncate text-meta text-text-tertiary">
                              {snippet(thread.latestMessage)}
                            </p>
                          </div>

                          <div className="order-2 ml-auto flex shrink-0 items-center gap-2 sm:order-3 sm:ml-0">
                            {hasAttachment ? (
                              <Paperclip
                                aria-hidden
                                className="h-3.5 w-3.5 text-text-tertiary"
                              />
                            ) : null}
                            <Hint
                              label={formatFullDate(
                                thread.latestMessage.receivedAt
                              )}
                            >
                              <span
                                className={cn(
                                  "cursor-help text-meta",
                                  unread
                                    ? "font-semibold text-text"
                                    : "text-text-tertiary"
                                )}
                                data-numeric
                              >
                                {formatMailDate(thread.latestMessage.receivedAt)}
                              </span>
                            </Hint>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      <ConnectInboxDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        organizationId={organizationId ?? ""}
      />

      <AttachmentPreviewDialog
        preview={preview}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}
