import { useEffect, useState } from "react";
import { Pencil, Plus, Server, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import {
  SMTPConnectionForm,
  emptySMTPConnectionForm,
  type SMTPConnectionFormValues
} from "../components/SMTPConnectionForm.js";
import { api, type SMTPConnection } from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { Button } from "../components/ui/button.js";
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

export function SMTPConnections() {
  const { currentOrganizationId: organizationId } = useSession();
  const [connections, setConnections] = useState<SMTPConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SMTPConnection | null>(null);
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
    setDialogOpen(true);
  }

  function openEdit(connection: SMTPConnection) {
    setEditing(connection);
    setDialogOpen(true);
  }

  const initialForm: SMTPConnectionFormValues = editing
    ? {
        name: editing.name,
        host: editing.host,
        port: String(editing.port),
        secure: editing.secure,
        username: "",
        password: "",
        fromEmail: editing.fromEmail,
        fromName: editing.fromName ?? "",
        isDefault: editing.isDefault
      }
    : {
        ...emptySMTPConnectionForm,
        name: "Default SMTP",
        isDefault: connections.length === 0
      };

  async function submit(form: SMTPConnectionFormValues) {
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
        toast.success("Sending account verified and updated.");
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
        toast.success("Sending account verified and saved.");
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
      toast.success("Sending account deleted.");
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
        title="Sending accounts"
        description="The mailboxes QQueue sends from. Connect one to start sending email (works with Mailcow and any standard SMTP server)."
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
              title="No sending accounts yet"
              description="Add your first account to start sending email."
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
              {editing ? "Edit sending account" : "New sending account"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Update the connection. Leave username/password blank to keep the saved credentials."
                : "Add SMTP credentials so QQueue can send email on your behalf."}
            </DialogDescription>
          </DialogHeader>
          <SMTPConnectionForm
            key={editing?.id ?? "new"}
            initial={initialForm}
            editing={Boolean(editing)}
            onSubmit={submit}
            footer={
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
            }
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete sending account?"
        description={`"${deleteTarget?.name}" will be permanently removed. Emails using it as default will need another account.`}
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </>
  );
}
