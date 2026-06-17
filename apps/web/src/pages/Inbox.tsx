import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Inbox as InboxIcon,
  MailOpen,
  MailPlus,
  Plug,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "../components/EmptyState.js";
import { PageHeader } from "../components/PageHeader.js";
import {
  api,
  ApiError,
  type InboxAccount,
  type InboundMessage,
} from "../lib/api.js";
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

export function Inbox() {
  const { currentOrganizationId: organizationId } = useSession();
  const [accounts, setAccounts] = useState<InboxAccount[]>([]);
  const [messages, setMessages] = useState<InboundMessage[]>([]);
  const [selected, setSelected] = useState<InboundMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [readFilter, setReadFilter] = useState<"all" | "unread" | "read">(
    "all"
  );
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
    setDisabled(false);
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
      setSelected((current) =>
        current
          ? (nextMessages.data.find((message) => message.id === current.id) ??
            nextMessages.data[0] ??
            null)
          : (nextMessages.data[0] ?? null)
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setDisabled(true);
        setAccounts([]);
        setMessages([]);
        setSelected(null);
        return;
      }
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

  async function openMessage(message: InboundMessage) {
    setSelected(message);
    if (!organizationId || message.readAt) return;
    try {
      const updated = await api.markInboundMessageRead(message.id, {
        organizationId,
        read: true,
      });
      setMessages((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
      setSelected(updated);
    } catch {
      // Reading locally still works if the read marker fails.
    }
  }

  return (
    <>
      <PageHeader
        title="Inbox"
        description="Read-only replies synced from connected IMAP mailboxes."
        actions={
          <Button
            onClick={() => setDialogOpen(true)}
            disabled={!organizationId || disabled}
          >
            <MailPlus className="h-4 w-4" />
            Connect mailbox
          </Button>
        }
      />

      <section className="space-y-6 p-6">
        {disabled ? (
          <EmptyState
            icon={InboxIcon}
            title="Inbox module disabled"
            description="Set INBOX_ENABLED=true for the API and worker to enable read-only IMAP sync."
          />
        ) : loading ? (
          <div className="flex min-h-60 items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
              <Card className="p-4">
                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-base font-semibold">Replies</h2>
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
                {messages.length === 0 ? (
                  <EmptyState
                    icon={MailOpen}
                    title="No replies synced"
                    description="Connected inboxes sync from the worker when the module is enabled."
                  />
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>From</TableHead>
                          <TableHead>Subject</TableHead>
                          <TableHead>Received</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {messages.map((message) => (
                          <TableRow
                            key={message.id}
                            className="cursor-pointer"
                            onClick={() => void openMessage(message)}
                          >
                            <TableCell>
                              <div className="font-medium">
                                {message.fromName ?? message.fromEmail}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {message.fromEmail}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div
                                className={
                                  !message.readAt ? "font-semibold" : ""
                                }
                              >
                                {message.subject || "(no subject)"}
                              </div>
                              <div className="max-w-lg truncate text-xs text-muted-foreground">
                                {snippet(message)}
                              </div>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm">
                              {formatDate(message.receivedAt)}
                            </TableCell>
                          </TableRow>
                        ))}
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
                  <h2 className="mb-3 text-base font-semibold">
                    Selected reply
                  </h2>
                  {selected ? (
                    <div className="space-y-3">
                      <div>
                        <div className="font-medium">
                          {selected.subject || "(no subject)"}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {selected.fromEmail}
                        </div>
                      </div>
                      {selected.emailJob ? (
                        <Badge variant="secondary">
                          Reply to {selected.emailJob.subject}
                        </Badge>
                      ) : (
                        <Badge variant="outline">Unmatched</Badge>
                      )}
                      <div className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">
                        {selected.text || "This reply has no plain-text body."}
                      </div>
                    </div>
                  ) : (
                    <EmptyState icon={MailOpen} title="No reply selected" />
                  )}
                </Card>
              </div>
            </div>
          </>
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
