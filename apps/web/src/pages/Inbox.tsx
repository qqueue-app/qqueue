import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Inbox as InboxIcon,
  Mail,
  MailOpen,
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
 * Laid out like a mail client rather than a dashboard page: a list on the left
 * and the conversation on the right, both filling the viewport, with no page
 * header eating the top of the screen. On a phone the two become one column
 * that swaps, which is what every native mail app does.
 */
export function Inbox() {
  const { currentOrganizationId: organizationId } = useSession();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [accountFilter, setAccountFilter] = useState("all");
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(
    null
  );
  // On narrow screens the list and reading pane share one column, so we show
  // one at a time: the list until a thread is opened, then the reading pane.
  const [mobileShowDetail, setMobileShowDetail] = useState(false);
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
      threads.find((thread) => thread.threadKey === selectedThreadKey) ?? null,
    [threads, selectedThreadKey]
  );
  const unreadCount = filteredMessages.filter(
    (message) => !message.readAt
  ).length;

  // Only the open thread's inline parts are fetched — the list pane renders no
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

  // Deep link from a push notification: /inbox?message=<id>. Select the thread
  // that message belongs to and open it, then drop the parameter so a later
  // refresh doesn't yank the reader back to an old message.
  useEffect(() => {
    const target = searchParams.get("message");
    if (!target || messages.length === 0) return;
    const message = messages.find((candidate) => candidate.id === target);
    if (!message) return;
    setSelectedThreadKey(threadKeyForMessage(message));
    setMobileShowDetail(true);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("message");
        return next;
      },
      { replace: true }
    );
  }, [searchParams, messages, setSearchParams]);

  // Keep a valid selection as the list changes, but never auto-select on a
  // phone — that would drop someone straight into a message they didn't pick.
  useEffect(() => {
    if (threads.length === 0) {
      setSelectedThreadKey(null);
      return;
    }
    if (
      !selectedThreadKey ||
      !threads.some((thread) => thread.threadKey === selectedThreadKey)
    ) {
      setSelectedThreadKey(threads[0].threadKey);
    }
  }, [threads, selectedThreadKey]);

  useEffect(() => {
    setReplyBody("");
  }, [selectedThreadKey]);

  function openThread(thread: ConversationThread) {
    setSelectedThreadKey(thread.threadKey);
    setMobileShowDetail(true);
    // Opening a conversation reads every message in it, the way a mail client
    // does — leaving older messages in a thread unread would keep the badge lit
    // with nothing left to click.
    thread.messages
      .filter((message) => !message.readAt)
      .forEach((message) => markRead.mutate({ id: message.id, read: true }));
  }

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

  return (
    /*
      The document is the only scroll container now (§2), so neither pane sets
      a height or an overflow: both grow to their content and the page scrolls.
      Their headers stay put with `sticky` instead, at the offset the shell
      publishes — which already accounts for the notch and the tablet top bar.
    */
    <div className="flex min-h-0 flex-col md:flex-row">
      {/* ---------------------------------------------------------------- list */}
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-col border-r md:flex md:w-[22rem] md:shrink-0 lg:w-[24rem]",
          mobileShowDetail ? "hidden" : "flex flex-1"
        )}
      >
        <header className="sticky top-sticky-top z-10 shrink-0 border-b bg-surface px-4 pb-3 pt-4">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight">Inbox</h1>
              <p className="text-xs text-muted-foreground">
                {unreadCount > 0
                  ? `${unreadCount} unread of ${filteredMessages.length}`
                  : `${filteredMessages.length} message${filteredMessages.length === 1 ? "" : "s"}`}
              </p>
            </div>
            <div className="flex items-center gap-0.5">
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

          <form
            className="mt-3"
            onSubmit={(event) => {
              event.preventDefault();
              setSubmittedSearch(search.trim());
            }}
          >
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onBlur={() => setSubmittedSearch(search.trim())}
              placeholder="Search mail"
              aria-label="Search mail"
              type="search"
            />
          </form>

          <div className="mt-3 flex items-center gap-2">
            <div className="flex flex-1 rounded-lg border bg-muted/40 p-0.5">
              {(["all", "unread", "read"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setReadFilter(value)}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors",
                    readFilter === value
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {value}
                </button>
              ))}
            </div>

            {accounts.length > 1 ? (
              <Select value={accountFilter} onValueChange={setAccountFilter}>
                <SelectTrigger
                  className="h-8 w-36 text-xs"
                  aria-label="Filter by mailbox"
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
          </div>

          {selectedAccount ? (
            <div className="mt-2 flex items-center gap-2 text-[0.7rem] text-muted-foreground">
              <Badge variant="outline" className="text-[0.65rem]">
                {selectedAccount.status}
              </Badge>
              <span className="truncate">
                Synced {formatFullDate(selectedAccount.lastSyncedAt)}
              </span>
              <IconButton
                label={`Disconnect ${selectedAccount.email}`}
                size="sm"
                variant="destructive"
                className="ml-auto"
                onClick={() => removeAccount.mutate(selectedAccount.id)}
              >
                <Trash2 />
              </IconButton>
            </div>
          ) : null}
        </header>

        <div className="min-h-0 flex-1">
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
                <Button onClick={() => setConnectOpen(true)}>
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
            <ul className="divide-y">
              {threads.map((thread) => {
                const selected = thread.threadKey === selectedThreadKey;
                const unread = thread.unreadCount > 0;
                return (
                  <li key={thread.threadKey}>
                    <button
                      type="button"
                      onClick={() => openThread(thread)}
                      aria-current={selected ? "true" : undefined}
                      className={cn(
                        "flex w-full gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        selected
                          ? "bg-primary/10"
                          : "hover:bg-accent/50"
                      )}
                    >
                      <Avatar name={thread.senderName} size="md" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className={cn(
                              "truncate text-sm",
                              unread
                                ? "font-semibold text-foreground"
                                : "text-muted-foreground"
                            )}
                          >
                            {thread.senderName}
                          </span>
                          <Hint
                            label={formatFullDate(
                              thread.latestMessage.receivedAt
                            )}
                          >
                            <span className="shrink-0 cursor-help text-[0.7rem] text-muted-foreground">
                              {formatMailDate(thread.latestMessage.receivedAt)}
                            </span>
                          </Hint>
                        </div>
                        <div
                          className={cn(
                            "mt-0.5 truncate text-sm",
                            unread ? "font-semibold" : "text-foreground/80"
                          )}
                        >
                          {thread.subject}
                        </div>
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                          {snippet(thread.latestMessage)}
                        </p>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          {unread ? (
                            <span
                              className="h-1.5 w-1.5 rounded-full bg-primary"
                              aria-label="Unread"
                            />
                          ) : null}
                          {thread.messages.length > 1 ? (
                            <span className="text-[0.65rem] text-muted-foreground">
                              {thread.messages.length} messages
                            </span>
                          ) : null}
                          {thread.latestMessage.attachments?.some(
                            (file) => !file.isInline
                          ) ? (
                            <Paperclip className="h-3 w-3 text-muted-foreground" />
                          ) : null}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* -------------------------------------------------------------- reader */}
      <div
        className={cn(
          "min-h-0 min-w-0 flex-1 flex-col md:flex",
          mobileShowDetail ? "flex" : "hidden"
        )}
      >
        {selectedThread ? (
          <>
            <header className="sticky top-sticky-top z-10 shrink-0 border-b bg-surface px-4 py-3 sm:px-6">
              <button
                type="button"
                onClick={() => setMobileShowDetail(false)}
                className="mb-2 -ml-1 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:hidden"
              >
                <ArrowLeft className="h-4 w-4" />
                Inbox
              </button>

              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold tracking-tight">
                    {selectedThread.subject}
                  </h2>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {selectedThread.senderName} · {selectedThread.senderEmail}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <IconButton
                    label="Mark as unread"
                    onClick={() =>
                      markRead.mutate({
                        id: selectedThread.latestMessage.id,
                        read: false,
                      })
                    }
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
            </header>

            <div className="min-h-0 flex-1 space-y-4 p-4 sm:p-6">
              {selectedThread.messages.map((message) => (
                <article
                  key={message.id}
                  className="rounded-2xl border bg-card p-4 shadow-sm"
                >
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar name={senderName(message)} size="sm" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {senderLabel(message)}
                        </div>
                        <div className="text-xs text-muted-foreground">
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
                    <div className="whitespace-pre-wrap text-sm leading-6">
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
                    <div className="mt-4 border-t pt-3">
                      <div className="mb-2 text-xs font-medium text-muted-foreground">
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
                                className="h-auto gap-2 py-1.5"
                              >
                                {openingId === file.id ? (
                                  <Spinner className="h-3.5 w-3.5" />
                                ) : (
                                  <Paperclip className="h-3.5 w-3.5" />
                                )}
                                <span className="max-w-[220px] truncate">
                                  {file.filename}
                                </span>
                                <span className="text-xs text-muted-foreground">
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
            </div>

            <form
              className="shrink-0 border-t bg-card p-4 sm:px-6"
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
                <p className="text-xs text-muted-foreground">
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
          </>
        ) : (
          <div className="flex min-h-[50vh] items-center justify-center">
            <EmptyState
              icon={MailOpen}
              title="Nothing selected"
              description="Pick a conversation on the left to read it."
            />
          </div>
        )}
      </div>

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
