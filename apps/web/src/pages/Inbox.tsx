import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  MailOpen,
  MailPlus,
  Plug,
  Reply,
  Search,
  Send,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "../components/EmptyState.js";
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
import { Spinner } from "../components/ui/spinner.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.js";
import { Textarea } from "../components/ui/textarea.js";

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
  return message.html ? "HTML message" : "No preview available";
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
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [replying, setReplying] = useState(false);
  const [search, setSearch] = useState("");
  const [readFilter, setReadFilter] = useState<"all" | "unread" | "read">(
    "all"
  );
  const [replyBody, setReplyBody] = useState("");
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

  const threads = useMemo(() => buildConversationThreads(messages), [messages]);
  const selectedThread = useMemo(
    () => threads.find((thread) => thread.threadKey === selectedThreadKey) ?? null,
    [threads, selectedThreadKey]
  );
  const unreadCount = useMemo(
    () => messages.filter((message) => !message.readAt).length,
    [messages]
  );

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
    if (threads.length === 0) {
      setSelectedThreadKey(null);
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
      toast.success("Reply queued.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to reply.");
    } finally {
      setReplying(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Inbox"
        description="Read synced IMAP conversations and reply from QQueue."
        actions={
          <Button
            onClick={() => setDialogOpen(true)}
            disabled={!organizationId}
          >
            <MailPlus className="h-4 w-4" />
            Connect mailbox
          </Button>
        }
      />

      <section className="space-y-6 p-6">
        {loading ? (
          <div className="flex min-h-60 items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
            <Card className="p-4">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-base font-semibold">Conversations</h2>
                  <p className="text-sm text-muted-foreground">
                    {messages.length} synced, {unreadCount} unread
                  </p>
                </div>
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
                    placeholder="Search"
                    className="w-48"
                  />
                  <Button type="submit" variant="outline" size="icon">
                    <Search className="h-4 w-4" />
                  </Button>
                </form>
              </div>
              <div className="mb-3 flex gap-2">
                {(["all", "unread", "read"] as const).map((value) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={readFilter === value ? "default" : "outline"}
                    onClick={() => setReadFilter(value)}
                  >
                    {value[0].toUpperCase()}
                    {value.slice(1)}
                  </Button>
                ))}
              </div>
              {threads.length === 0 ? (
                <EmptyState
                  icon={MailOpen}
                  title="No conversations synced"
                  description="Connected inboxes sync read-only replies from the worker."
                />
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Conversation</TableHead>
                        <TableHead>Latest message</TableHead>
                        <TableHead>Received</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {threads.map((thread) => {
                        const selected = thread.threadKey === selectedThreadKey;
                        return (
                          <TableRow
                            key={thread.threadKey}
                            className={`cursor-pointer ${selected ? "bg-muted/50" : ""}`}
                            onClick={() => void openThread(thread)}
                          >
                            <TableCell>
                              <div className="font-medium">{thread.sender}</div>
                              <div className="text-xs text-muted-foreground">
                                {thread.subject}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <Badge variant="outline">
                                  {thread.messages.length} message
                                  {thread.messages.length === 1 ? "" : "s"}
                                </Badge>
                                {thread.unreadCount > 0 ? (
                                  <Badge variant="secondary">
                                    {thread.unreadCount} unread
                                  </Badge>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="max-w-lg truncate text-sm text-muted-foreground">
                                {snippet(thread.latestMessage)}
                              </div>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm">
                              {formatDate(thread.latestMessage.receivedAt)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>

            <div className="space-y-4">
              <Card className="p-4">
                <h2 className="mb-3 text-base font-semibold">Mailboxes</h2>
                {accounts.length === 0 ? (
                  <EmptyState
                    icon={Plug}
                    title="No mailbox connected"
                    description="Connect an IMAP mailbox to sync replies."
                  />
                ) : (
                  <div className="space-y-3">
                    {accounts.map((account) => (
                      <div
                        key={account.id}
                        className="flex items-start justify-between gap-3 rounded-md border p-3"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {account.name}
                          </div>
                          <div className="truncate text-sm text-muted-foreground">
                            {account.email}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <Badge variant="outline">{account.status}</Badge>
                            <span>{account.mailbox}</span>
                            <span>
                              Synced {formatDate(account.lastSyncedAt)}
                            </span>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => void deleteAccount(account)}
                          aria-label="Remove inbox account"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card className="p-4">
                <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
                  <Reply className="h-4 w-4" />
                  Conversation
                </h2>
                {selectedThread ? (
                  <div className="space-y-4">
                    <div>
                      <div className="font-medium">{selectedThread.subject}</div>
                      <div className="text-sm text-muted-foreground">
                        {selectedThread.sender}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge variant="outline">
                          {selectedThread.messages.length} message
                          {selectedThread.messages.length === 1 ? "" : "s"}
                        </Badge>
                        {selectedThread.unreadCount > 0 ? (
                          <Badge variant="secondary">
                            {selectedThread.unreadCount} unread
                          </Badge>
                        ) : null}
                      </div>
                    </div>

                    <div className="space-y-3">
                      {selectedThread.messages.map((message) => (
                        <div
                          key={message.id}
                          className="rounded-md border bg-muted/20 p-3"
                        >
                          <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>{senderLabel(message)}</span>
                            <span>{formatDate(message.receivedAt)}</span>
                          </div>
                          {message.emailJob ? (
                            <Badge className="mb-2" variant="outline">
                              Reply to {message.emailJob.subject}
                            </Badge>
                          ) : null}
                          <div className="whitespace-pre-wrap text-sm">
                            {message.text || "This reply has no plain-text body."}
                          </div>
                        </div>
                      ))}
                    </div>

                    <form className="space-y-3" onSubmit={submitReply}>
                      <Textarea
                        value={replyBody}
                        onChange={(event) => setReplyBody(event.target.value)}
                        placeholder={`Reply to ${selectedThread.latestMessage.fromEmail}`}
                        rows={5}
                      />
                      <Button
                        type="submit"
                        disabled={replying || !replyBody.trim()}
                      >
                        {replying ? <Spinner /> : <Send className="h-4 w-4" />}
                        Send reply
                      </Button>
                    </form>
                  </div>
                ) : (
                  <EmptyState icon={MailOpen} title="No conversation selected" />
                )}
              </Card>
            </div>
          </div>
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect mailbox</DialogTitle>
            <DialogDescription>
              QQueue verifies the IMAP login and opens the mailbox read-only.
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
                <Label htmlFor="inbox-host">IMAP host</Label>
                <Input
                  id="inbox-host"
                  value={form.host}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      host: event.target.value,
                    }))
                  }
                  required
                />
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
                <Label htmlFor="inbox-mailbox">Mailbox</Label>
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
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.secure}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      secure: event.target.checked,
                    }))
                  }
                />
                Use TLS
              </label>
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
