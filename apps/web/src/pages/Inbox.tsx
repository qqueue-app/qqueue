import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  MailOpen,
  MailPlus,
  Paperclip,
  Plug,
  Reply,
  Search,
  Send,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "../components/EmptyState.js";
import { InboundHtmlFrame } from "../components/InboundHtmlFrame.js";
import { PageHeader } from "../components/PageHeader.js";
import { api, type InboxAccount, type InboundMessage } from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card } from "../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import { Spinner } from "../components/ui/spinner.js";
import { Textarea } from "../components/ui/textarea.js";
import { Switch } from "../components/ui/switch.js";
import { cn } from "../lib/utils.js";

type ConversationThread = {
  threadKey: string;
  messages: InboundMessage[];
  latestMessage: InboundMessage;
  sender: string;
  subject: string;
  unreadCount: number;
};

function formatDate(value?: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Never" : date.toLocaleString();
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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function senderLabel(message: InboundMessage) {
  return message.fromName
    ? `${message.fromName} <${message.fromEmail}>`
    : message.fromEmail;
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
        sender: senderLabel(message),
        subject: message.subject || "(no subject)",
        unreadCount: message.readAt ? 0 : 1,
      });
      continue;
    }

    current.messages.push(message);
    current.messages.sort(compareMessages);
    current.latestMessage =
      current.messages[current.messages.length - 1] ?? current.latestMessage;
    current.sender = senderLabel(current.latestMessage);
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

export function Inbox() {
  const { currentOrganizationId: organizationId } = useSession();
  const [accounts, setAccounts] = useState<InboxAccount[]>([]);
  const [messages, setMessages] = useState<InboundMessage[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(
    null
  );
  // On narrow screens the list and reading pane share one column, so we show
  // one at a time: the list until the user taps a thread, then the reading
  // pane (with a Back control). The desktop two-pane layout ignores this.
  const [mobileShowDetail, setMobileShowDetail] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [replying, setReplying] = useState(false);
  const [search, setSearch] = useState("");
  const [readFilter, setReadFilter] = useState<"all" | "unread" | "read">(
    "all"
  );
  const [replyBody, setReplyBody] = useState("");
  // Per-message opt-in to loading remote images. Deliberately not persisted:
  // the choice lasts for the session, so a tracking pixel fires at most once
  // and only after the reader explicitly asked for images.
  const [remoteContentAllowed, setRemoteContentAllowed] = useState<Set<string>>(
    () => new Set()
  );
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    host: "",
    port: "993",
    secure: true,
    username: "",
    password: "",
    mailbox: "INBOX",
  });

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  );
  const filteredMessages = useMemo(
    () =>
      selectedAccountId === "all"
        ? messages
        : messages.filter(
            (message) => message.inboxAccountId === selectedAccountId
          ),
    [messages, selectedAccountId]
  );
  const threads = useMemo(
    () => buildConversationThreads(filteredMessages),
    [filteredMessages]
  );
  const selectedThread = useMemo(
    () => threads.find((thread) => thread.threadKey === selectedThreadKey) ?? null,
    [threads, selectedThreadKey]
  );
  const unreadCount = useMemo(
    () => filteredMessages.filter((message) => !message.readAt).length,
    [filteredMessages]
  );

  async function downloadAttachment(
    messageId: string,
    file: { id: string; filename: string }
  ) {
    if (!organizationId) return;
    setDownloadingId(file.id);
    try {
      const blob = await api.downloadInboundAttachment({
        messageId,
        attachmentId: file.id,
        organizationId,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Unable to download attachment");
    } finally {
      setDownloadingId(null);
    }
  }

  function allowRemoteContent(messageId: string) {
    setRemoteContentAllowed((current) => {
      const next = new Set(current);
      next.add(messageId);
      return next;
    });
  }

  async function load() {
    if (!organizationId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [nextAccounts, nextMessages] = await Promise.all([
        api.listInboxAccounts(organizationId),
        api.listInboundMessages({
          organizationId,
          q: search || undefined,
          read: readFilter,
        }),
      ]);
      setAccounts(nextAccounts);
      setMessages(nextMessages.data);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load inbox"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [organizationId, readFilter]);

  useEffect(() => {
    if (
      selectedAccountId !== "all" &&
      !accounts.some((account) => account.id === selectedAccountId)
    ) {
      setSelectedAccountId("all");
    }
  }, [accounts, selectedAccountId]);

  useEffect(() => {
    if (threads.length === 0) {
      setSelectedThreadKey(null);
      setMobileShowDetail(false);
      return;
    }

    if (!selectedThreadKey || !threads.some((thread) => thread.threadKey === selectedThreadKey)) {
      setSelectedThreadKey(threads[0].threadKey);
    }
  }, [threads, selectedThreadKey]);

  useEffect(() => {
    setReplyBody("");
  }, [selectedThreadKey]);

  async function submitAccount(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) {
      toast.error("Select an organization first.");
      return;
    }

    setSaving(true);
    try {
      const account = await api.createInboxAccount({
        organizationId,
        ...form,
        port: Number(form.port),
      });
      toast.success(`Connected ${account.email}.`);
      setDialogOpen(false);
      setForm({
        name: "",
        email: "",
        host: "",
        port: "993",
        secure: true,
        username: "",
        password: "",
        mailbox: "INBOX",
      });
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to connect mailbox"
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteAccount(account: InboxAccount) {
    if (!organizationId) return;
    try {
      await api.deleteInboxAccount(account.id, organizationId);
      toast.success("Inbox account removed.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to remove.");
    }
  }

  async function openThread(thread: ConversationThread) {
    setSelectedThreadKey(thread.threadKey);
    setMobileShowDetail(true);
    if (!organizationId) return;

    const unreadMessages = thread.messages.filter((message) => !message.readAt);
    if (unreadMessages.length === 0) return;

    try {
      for (const message of unreadMessages) {
        const updated = await api.markInboundMessageRead(message.id, {
          organizationId,
          read: true,
        });
        setMessages((current) =>
          current.map((item) => (item.id === updated.id ? updated : item))
        );
      }
    } catch {
      // Keep the local view usable even if the read marker fails.
    }
  }

  async function submitReply(event: FormEvent) {
    event.preventDefault();
    if (!organizationId || !selectedThread || !replyBody.trim()) return;

    setReplying(true);
    try {
      await api.replyToInboundMessage(selectedThread.latestMessage.id, {
        organizationId,
        subject: selectedThread.latestMessage.subject || "(no subject)",
        text: replyBody,
      });
      setReplyBody("");
      toast.success("Reply sent.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to reply.");
    } finally {
      setReplying(false);
    }
  }

  return (
    <>
      <div className="flex min-h-0 flex-col md:h-full">
        <PageHeader
          title="Inbox"
          description="Read replies to your emails and respond — all in one place."
          actions={
            <Button
              onClick={() => setDialogOpen(true)}
              disabled={!organizationId}
            >
              <MailPlus className="h-4 w-4" />
              Connect an inbox
            </Button>
          }
        />

        <section className="min-h-0 flex-1 p-5 sm:p-6 xl:overflow-hidden">
          {loading ? (
            <div className="flex min-h-60 items-center justify-center">
              <Spinner />
            </div>
          ) : (
            <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
              <Card
                className={cn(
                  "min-h-[28rem] flex-col overflow-hidden xl:flex xl:min-h-0",
                  mobileShowDetail ? "hidden" : "flex"
                )}
              >
                <div className="shrink-0 space-y-3 border-b p-4">
                <div className="space-y-2">
                  <Label
                    htmlFor="inbox-mailbox-filter"
                    className="text-xs text-muted-foreground"
                  >
                    Account
                  </Label>
                  <div className="flex gap-2">
                    <Select
                      value={selectedAccountId}
                      onValueChange={setSelectedAccountId}
                      disabled={accounts.length === 0}
                    >
                      <SelectTrigger id="inbox-mailbox-filter">
                        <SelectValue placeholder="Select account" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">
                          All inboxes ({accounts.length})
                        </SelectItem>
                        {accounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.name} ({account.email})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={!selectedAccount}
                      onClick={() => {
                        if (selectedAccount) void deleteAccount(selectedAccount);
                      }}
                      aria-label="Remove this inbox"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div>
                  <h2 className="text-base font-semibold">Conversations</h2>
                  <p className="text-sm text-muted-foreground">
                    {filteredMessages.length} synced, {unreadCount} unread
                  </p>
                </div>
                {accounts.length === 0 ? (
                  <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                      <Plug className="h-4 w-4 shrink-0" />
                      <span>No inbox connected yet.</span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setDialogOpen(true)}
                    >
                      <MailPlus className="h-4 w-4" />
                      Connect an inbox
                    </Button>
                  </div>
                ) : selectedAccount ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <Badge variant="outline">{selectedAccount.status}</Badge>
                    <Badge variant="secondary">{selectedAccount.mailbox}</Badge>
                    <span>Synced {formatDate(selectedAccount.lastSyncedAt)}</span>
                  </div>
                ) : null}
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void load();
                  }}
                >
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search inbox"
                    className="min-w-0"
                  />
                  <Button type="submit" variant="outline" size="icon" aria-label="Search inbox">
                    <Search className="h-4 w-4" />
                  </Button>
                </form>
                <div className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/30 p-1">
                  {(["all", "unread", "read"] as const).map((value) => (
                    <Button
                      key={value}
                      type="button"
                      size="sm"
                      variant={readFilter === value ? "secondary" : "ghost"}
                      onClick={() => setReadFilter(value)}
                    >
                      {value[0].toUpperCase()}
                      {value.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>
                {threads.length === 0 ? (
                  <div className="flex-1">
                    <EmptyState
                      icon={MailOpen}
                      title="No conversations yet"
                      description="Replies will appear here once your inbox finishes syncing."
                    />
                  </div>
                ) : (
                  <div className="scrollbar-hidden min-h-0 flex-1 divide-y overflow-y-auto">
                  {threads.map((thread) => {
                    const selected = thread.threadKey === selectedThreadKey;
                    return (
                      <button
                        key={thread.threadKey}
                        type="button"
                        className={`block w-full px-4 py-3 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                          selected ? "bg-primary/10" : "bg-card"
                        }`}
                        onClick={() => void openThread(thread)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              {thread.unreadCount > 0 ? (
                                <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />
                              ) : null}
                              <span
                                className={`truncate text-sm ${
                                  thread.unreadCount > 0
                                    ? "font-semibold"
                                    : "font-normal text-muted-foreground"
                                }`}
                              >
                                {thread.sender}
                              </span>
                            </div>
                            <div
                              className={`mt-1 truncate text-sm ${
                                thread.unreadCount > 0
                                  ? "font-semibold"
                                  : "font-normal"
                              }`}
                            >
                              {thread.subject}
                            </div>
                          </div>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {formatDate(thread.latestMessage.receivedAt)}
                          </span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {snippet(thread.latestMessage)}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <Badge variant="outline">
                            {thread.messages.length} message
                            {thread.messages.length === 1 ? "" : "s"}
                          </Badge>
                          {thread.unreadCount > 0 ? (
                            <Badge variant="default">
                              {thread.unreadCount} unread
                            </Badge>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                  </div>
                )}
              </Card>

              <Card
                className={cn(
                  "min-h-[32rem] flex-col overflow-hidden xl:flex xl:min-h-0",
                  mobileShowDetail ? "flex" : "hidden"
                )}
              >
                {selectedThread ? (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="shrink-0 border-b bg-muted/20 p-5">
                    <button
                      type="button"
                      onClick={() => setMobileShowDetail(false)}
                      className="mb-3 -ml-1 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground xl:hidden"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      All conversations
                    </button>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-xl font-semibold tracking-tight">
                          {selectedThread.subject}
                        </h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Conversation with {selectedThread.sender}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="outline">
                          {selectedThread.messages.length} message
                          {selectedThread.messages.length === 1 ? "" : "s"}
                        </Badge>
                        {selectedThread.unreadCount > 0 ? (
                          <Badge>{selectedThread.unreadCount} unread</Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="scrollbar-hidden min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                    {selectedThread.messages.map((message) => (
                      <article
                        key={message.id}
                        className="rounded-2xl border bg-background/70 p-4 shadow-sm"
                      >
                        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold">
                              {senderLabel(message)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatDate(message.receivedAt)}
                            </div>
                          </div>
                          {message.emailJob ? (
                            <Badge variant="outline">
                              Reply to {message.emailJob.subject}
                            </Badge>
                          ) : null}
                        </div>
                        {/*
                          Prefer the HTML part. It has always been synced into
                          InboundMessage.html; the pane just never rendered it,
                          so formatted mail (tables especially) was shown as the
                          flattened text/plain alternative. Fall back to text
                          only when there is no HTML part.
                        */}
                        {message.html ? (
                          <InboundHtmlFrame
                            html={message.html}
                            showRemoteContent={remoteContentAllowed.has(
                              message.id
                            )}
                            title={`Message from ${senderLabel(message)}`}
                          />
                        ) : (
                          <div className="whitespace-pre-wrap text-sm leading-6">
                            {message.text || "This message has no body."}
                          </div>
                        )}
                        {/*
                          Downloadable parts. Inline parts (cid: images the
                          sender meant to render in the body) are filtered out
                          so a signature logo doesn't look like an attachment.
                        */}
                        {(message.attachments ?? []).filter(
                          (file) => !file.isInline
                        ).length > 0 ? (
                          <div className="mt-4 border-t pt-3">
                            <div className="mb-2 text-xs font-medium text-muted-foreground">
                              Attachments
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {(message.attachments ?? [])
                                .filter((file) => !file.isInline)
                                .map((file) => (
                                  <Button
                                    key={file.id}
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={downloadingId === file.id}
                                    onClick={() =>
                                      void downloadAttachment(message.id, file)
                                    }
                                    className="h-auto gap-2 py-1.5"
                                  >
                                    {downloadingId === file.id ? (
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
                                ))}
                            </div>
                          </div>
                        ) : null}
                        {message.html && !remoteContentAllowed.has(message.id) ? (
                          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-2">
                            <span className="text-xs text-muted-foreground">
                              Remote images are blocked so the sender can&apos;t
                              track when you open this.
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => allowRemoteContent(message.id)}
                            >
                              Show images
                            </Button>
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>

                  <form
                    className="shrink-0 border-t bg-card p-4"
                    onSubmit={submitReply}
                  >
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                      <Reply className="h-4 w-4 text-primary" />
                      Reply
                    </div>
                    <Textarea
                      value={replyBody}
                      onChange={(event) => setReplyBody(event.target.value)}
                      placeholder={`Reply to ${selectedThread.latestMessage.fromEmail}`}
                      rows={5}
                      className="resize-y"
                    />
                    <div className="mt-3 flex justify-end">
                      <Button
                        type="submit"
                        disabled={replying || !replyBody.trim()}
                      >
                        {replying ? <Spinner /> : <Send className="h-4 w-4" />}
                        Send reply
                      </Button>
                    </div>
                  </form>
                  </div>
                ) : (
                  <EmptyState
                    icon={MailOpen}
                    title="Select a conversation"
                    description="Choose a thread to read messages and reply."
                  />
                )}
              </Card>
            </div>
          )}
        </section>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect an inbox</DialogTitle>
            <DialogDescription>
              We check the connection and open your inbox read-only — QQueue
              never sends or deletes from it. You can usually find these details
              listed under IMAP in your email provider settings.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitAccount}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="inbox-name">Name</Label>
                <Input
                  id="inbox-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inbox-email">Email</Label>
                <Input
                  id="inbox-email"
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      email: event.target.value,
                      username: current.username || event.target.value,
                    }))
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inbox-host">Mail server</Label>
                <Input
                  id="inbox-host"
                  placeholder="imap.gmail.com"
                  value={form.host}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      host: event.target.value,
                    }))
                  }
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Your incoming (IMAP) mail server.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="inbox-port">Port</Label>
                <Input
                  id="inbox-port"
                  inputMode="numeric"
                  value={form.port}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      port: event.target.value,
                    }))
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inbox-username">Username</Label>
                <Input
                  id="inbox-username"
                  value={form.username}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      username: event.target.value,
                    }))
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inbox-password">Password</Label>
                <Input
                  id="inbox-password"
                  type="password"
                  value={form.password}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inbox-mailbox">Folder</Label>
                <Input
                  id="inbox-mailbox"
                  value={form.mailbox}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      mailbox: event.target.value,
                    }))
                  }
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Which folder to read. Usually INBOX.
                </p>
              </div>
              <div className="flex items-end justify-between gap-3 rounded-xl border p-3">
                <div>
                  <Label>Secure connection (TLS)</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Recommended — leave this on for most providers.
                  </p>
                </div>
                <Switch
                  checked={form.secure}
                  onCheckedChange={(secure) =>
                    setForm((current) => ({
                      ...current,
                      secure,
                    }))
                  }
                  aria-label="Secure connection (TLS)"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={saving}>
                {saving ? <Spinner /> : <Plug className="h-4 w-4" />}
                Connect
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
