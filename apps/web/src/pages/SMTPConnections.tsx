import { FormEvent, useEffect, useState } from "react";
import { Pencil, Plus, Server, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { api, type SMTPConnection } from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { Button } from "../components/ui/button.js";
import { Checkbox } from "../components/ui/checkbox.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Badge } from "../components/ui/badge.js";
import { Spinner } from "../components/ui/spinner.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { Card, CardContent } from "../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../components/ui/dialog.js";

interface ConnectionForm {
  name: string;
  host: string;
  port: string;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
  isDefault: boolean;
}

const emptyForm: ConnectionForm = {
  name: "",
  host: "",
  port: "587",
  secure: false,
  username: "",
  password: "",
  fromEmail: "",
  fromName: "",
  isDefault: false
};

export function SMTPConnections() {
  const { currentOrganizationId: organizationId } = useSession();
  const [connections, setConnections] = useState<SMTPConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SMTPConnection | null>(null);
  const [form, setForm] = useState<ConnectionForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SMTPConnection | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    if (!organizationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setConnections(await api.listSMTPConnections(organizationId));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load SMTP connections"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [organizationId]);

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyForm, name: "Default SMTP", isDefault: connections.length === 0 });
    setDialogOpen(true);
  }

  function openEdit(connection: SMTPConnection) {
    setEditing(connection);
    setForm({
      name: connection.name,
      host: connection.host,
      port: String(connection.port),
      secure: connection.secure,
      username: "",
      password: "",
      fromEmail: connection.fromEmail,
      fromName: connection.fromName ?? "",
      isDefault: connection.isDefault
    });
    setDialogOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) {
      toast.error("Select an organization in Settings first.");
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        // Partial update — only send credentials if the user re-entered them.
        const payload: Record<string, unknown> = {
          organizationId,
          name: form.name,
          host: form.host,
          port: Number(form.port),
          secure: form.secure,
          fromEmail: form.fromEmail,
          fromName: form.fromName || undefined,
          isDefault: form.isDefault
        };
        if (form.username) payload.username = form.username;
        if (form.password) payload.password = form.password;
        await api.updateSMTPConnection(editing.id, payload);
        toast.success("SMTP connection verified and updated.");
      } else {
        await api.createSMTPConnection({
          organizationId,
          name: form.name,
          host: form.host,
          port: Number(form.port),
          secure: form.secure,
          username: form.username,
          password: form.password,
          fromEmail: form.fromEmail,
          fromName: form.fromName || undefined,
          isDefault: form.isDefault
        });
        toast.success("SMTP connection verified and saved.");
      }
      setDialogOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save SMTP.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteSMTPConnection(deleteTarget.id);
      toast.success("SMTP connection deleted.");
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="SMTP Connections"
        description="Manage SMTP credentials for Mailcow-compatible and generic SMTP sending."
        actions={
          <Button onClick={openCreate} disabled={!organizationId}>
            <Plus className="h-4 w-4" />
            New connection
          </Button>
        }
      />

      <section className="space-y-3 p-6">
        {loading ? (
          [0, 1].map((index) => (
            <Card key={index}>
              <CardContent className="p-5">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="mt-2 h-4 w-64" />
              </CardContent>
            </Card>
          ))
        ) : connections.length === 0 ? (
          <Card>
            <EmptyState
              icon={Server}
              title="No SMTP connections yet"
              description="Add your first connection to start sending email."
              action={
                <Button onClick={openCreate} disabled={!organizationId} variant="outline">
                  <Plus className="h-4 w-4" />
                  New connection
                </Button>
              }
            />
          </Card>
        ) : (
          connections.map((connection) => (
            <Card key={connection.id}>
              <CardContent className="flex flex-wrap items-start justify-between gap-3 p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{connection.name}</h2>
                    {connection.isDefault ? <Badge>Default</Badge> : null}
                    <Badge variant="secondary">
                      {connection.secure ? "TLS" : "STARTTLS"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {connection.host}:{connection.port} · from{" "}
                    {connection.fromEmail}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => openEdit(connection)}
                    aria-label="Edit connection"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteTarget(connection)}
                    aria-label="Delete connection"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit SMTP connection" : "New SMTP connection"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Update the connection. Leave username/password blank to keep the saved credentials."
                : "Add SMTP credentials so QQueue can send email on your behalf."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <div className="space-y-2">
                <Label htmlFor="host">Host</Label>
                <Input
                  id="host"
                  placeholder="smtp.example.com"
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="port">Port</Label>
                <Input
                  id="port"
                  inputMode="numeric"
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="username">
                  Username{editing ? " (optional)" : ""}
                </Label>
                <Input
                  id="username"
                  autoComplete="off"
                  placeholder={editing ? "Keep current" : ""}
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  required={!editing}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">
                  Password{editing ? " (optional)" : ""}
                </Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder={editing ? "Keep current" : ""}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required={!editing}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="fromEmail">From email</Label>
                <Input
                  id="fromEmail"
                  type="email"
                  placeholder="hello@example.com"
                  value={form.fromEmail}
                  onChange={(e) => setForm({ ...form, fromEmail: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fromName">From name</Label>
                <Input
                  id="fromName"
                  value={form.fromName}
                  onChange={(e) => setForm({ ...form, fromName: e.target.value })}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-5">
              <label
                htmlFor="smtp-secure"
                className="flex items-center gap-2.5 text-sm font-medium"
              >
                <Checkbox
                  id="smtp-secure"
                  checked={form.secure}
                  onCheckedChange={(checked) =>
                    setForm({ ...form, secure: checked })
                  }
                />
                Secure TLS
              </label>
              <label
                htmlFor="smtp-default"
                className="flex items-center gap-2.5 text-sm font-medium"
              >
                <Checkbox
                  id="smtp-default"
                  checked={form.isDefault}
                  onCheckedChange={(checked) =>
                    setForm({ ...form, isDefault: checked })
                  }
                />
                Use as default sender
              </label>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Spinner /> : null}
                {editing ? "Test and save" : "Test and create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete SMTP connection?"
        description={`"${deleteTarget?.name}" will be permanently removed. Emails using it as default will need another connection.`}
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </>
  );
}
