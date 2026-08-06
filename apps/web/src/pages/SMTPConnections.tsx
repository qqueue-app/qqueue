import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Plus, PlugZap, Server, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import {
  SMTPConnectionForm,
  emptySMTPConnectionForm,
  type SMTPConnectionFormValues,
} from "../components/SMTPConnectionForm.js";
import { api, type SMTPConnection } from "../lib/api.js";
import { qk } from "../lib/query-client.js";
import { errorMessage, useApiMutation, useOrgQuery } from "../lib/use-api.js";
import { useSession } from "../lib/session-context.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { DataGrid } from "../components/ui/data-grid.js";
import { RowActions } from "../components/ui/row-actions.js";
import { Spinner } from "../components/ui/spinner.js";
import { Hint } from "../components/ui/tooltip.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";

export function SMTPConnections() {
  const { currentOrganizationId: organizationId, currentOrganization } =
    useSession();
  // Writes are OWNER/ADMIN on the API; hide the controls members can't use.
  // The server remains the enforcement point.
  const canManage =
    currentOrganization?.role === "OWNER" ||
    currentOrganization?.role === "ADMIN";

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SMTPConnection | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SMTPConnection | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const connectionsQuery = useOrgQuery(
    organizationId,
    qk.smtpConnections(organizationId ?? ""),
    (id) => api.listSMTPConnections(id)
  );
  const connections = useMemo(
    () => connectionsQuery.data ?? [],
    [connectionsQuery.data]
  );

  const save = useApiMutation(
    (form: SMTPConnectionFormValues) => {
      if (editing) {
        // Partial update — only send credentials if they were re-entered, so
        // saving a name change doesn't wipe the stored password.
        const payload: Record<string, unknown> = {
          organizationId,
          name: form.name,
          host: form.host,
          port: Number(form.port),
          secure: form.secure,
          fromEmail: form.fromEmail,
          fromName: form.fromName || undefined,
          isDefault: form.isDefault,
        };
        if (form.username) payload.username = form.username;
        if (form.password) payload.password = form.password;
        return api.updateSMTPConnection(editing.id, payload);
      }
      return api.createSMTPConnection({
        organizationId,
        name: form.name,
        host: form.host,
        port: Number(form.port),
        secure: form.secure,
        username: form.username,
        password: form.password,
        fromEmail: form.fromEmail,
        fromName: form.fromName || undefined,
        isDefault: form.isDefault,
      });
    },
    {
      successMessage: "Checked the credentials and saved the account.",
      errorMessage: "Couldn't save that sending account.",
      invalidates: [qk.smtpConnections(organizationId ?? "")],
      onSuccess: () => setDialogOpen(false),
    }
  );

  const remove = useApiMutation(
    (connection: SMTPConnection) => api.deleteSMTPConnection(connection.id),
    {
      successMessage: "Sending account deleted.",
      errorMessage: "Couldn't delete that account.",
      invalidates: [qk.smtpConnections(organizationId ?? "")],
      onSuccess: () => setDeleteTarget(null),
    }
  );

  async function testConnection(connection: SMTPConnection) {
    setTestingId(connection.id);
    const toastId = toast.loading(`Testing ${connection.name}…`);
    try {
      const result = await api.verifySMTPConnection(connection.id);
      if (result.verified) {
        toast.success(`${connection.name} works.`, { id: toastId });
      } else {
        toast.error(result.message ?? "Couldn't verify that connection.", {
          id: toastId,
        });
      }
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't test that connection."), {
        id: toastId,
      });
    } finally {
      setTestingId(null);
    }
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
        isDefault: editing.isDefault,
      }
    : {
        ...emptySMTPConnectionForm,
        name: "Default SMTP",
        isDefault: connections.length === 0,
      };

  const columns = useMemo<ColumnDef<SMTPConnection, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Account",
        meta: { title: "Account" },
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{row.original.name}</span>
              {row.original.isDefault ? (
                <Hint label="Mail sends from this account unless another is chosen">
                  <Badge className="cursor-help">Default</Badge>
                </Hint>
              ) : null}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {row.original.fromEmail}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "fromEmail",
        header: "Sends as",
        meta: { title: "Sends as", hideBelowLg: true },
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.fromName
              ? `${row.original.fromName} <${row.original.fromEmail}>`
              : row.original.fromEmail}
          </span>
        ),
      },
      {
        id: "server",
        accessorFn: (row) => `${row.host}:${row.port}`,
        header: "Server",
        meta: { title: "Server", hideBelowMd: true },
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {String(getValue())}
          </span>
        ),
      },
      {
        accessorKey: "secure",
        header: "Encryption",
        meta: { title: "Encryption", hideBelowLg: true },
        cell: ({ getValue }) => (
          <Hint
            label={
              getValue()
                ? "Encrypted from the moment it connects (implicit TLS, usually port 465)"
                : "Starts unencrypted, then upgrades (STARTTLS, usually port 587)"
            }
          >
            <Badge variant="secondary" className="cursor-help">
              {getValue() ? "TLS" : "STARTTLS"}
            </Badge>
          </Hint>
        ),
      },
      {
        id: "actions",
        header: "",
        meta: { pinned: true, align: "right" },
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions
            rowLabel={row.original.name}
            actions={[
              {
                label: "Check this account still works",
                icon: PlugZap,
                primary: true,
                disabled: testingId !== null,
                onSelect: () => void testConnection(row.original),
              },
              {
                label: "Edit this account",
                icon: Pencil,
                hidden: !canManage,
                onSelect: () => {
                  setEditing(row.original);
                  setDialogOpen(true);
                },
              },
              {
                label: "Delete this account",
                icon: Trash2,
                destructive: true,
                hidden: !canManage,
                onSelect: () => setDeleteTarget(row.original),
              },
            ]}
          />
        ),
      },
    ],
    [canManage, testingId]
  );

  return (
    <>
      <PageHeader
        title="Sending accounts"
        description="The mailboxes QQueue sends from. Connect one to start sending — it works with Mailcow and any standard SMTP server."
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
              disabled={!organizationId}
            >
              <Plus className="h-4 w-4" />
              New account
            </Button>
          ) : undefined
        }
      />

      <section className="p-4 sm:p-6">
        <DataGrid
          label="Sending accounts"
          data={connections}
          columns={columns}
          getRowId={(row) => row.id}
          loading={connectionsQuery.isPending}
          searchPlaceholder="Search sending accounts…"
          empty={
            <EmptyState
              icon={Server}
              title="No sending accounts yet"
              description={
                canManage
                  ? "Add your first account and QQueue can start sending email."
                  : "An owner or admin needs to add one before this organization can send email."
              }
              action={
                canManage ? (
                  <Button
                    onClick={() => {
                      setEditing(null);
                      setDialogOpen(true);
                    }}
                    disabled={!organizationId}
                    variant="outline"
                  >
                    <Plus className="h-4 w-4" />
                    New account
                  </Button>
                ) : undefined
              }
            />
          }
          noResults={
            <EmptyState
              icon={Server}
              title="No matching accounts"
              description="Try a different search."
            />
          }
          renderMobileRow={(connection) => (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">
                    {connection.name}
                  </span>
                  {connection.isDefault ? <Badge>Default</Badge> : null}
                </div>
                <div className="truncate text-sm text-muted-foreground">
                  {connection.fromEmail}
                </div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">
                  {connection.host}:{connection.port}
                </div>
              </div>
              <RowActions
                rowLabel={connection.name}
                actions={[
                  {
                    label: "Check this account still works",
                    icon: PlugZap,
                    primary: true,
                    disabled: testingId !== null,
                    onSelect: () => void testConnection(connection),
                  },
                  {
                    label: "Edit this account",
                    icon: Pencil,
                    hidden: !canManage,
                    onSelect: () => {
                      setEditing(connection);
                      setDialogOpen(true);
                    },
                  },
                  {
                    label: "Delete this account",
                    icon: Trash2,
                    destructive: true,
                    hidden: !canManage,
                    onSelect: () => setDeleteTarget(connection),
                  },
                ]}
              />
            </div>
          )}
        />
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit sending account" : "New sending account"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Leave the username and password blank to keep the ones already saved."
                : "QQueue checks these details before saving, so you'll know straight away if something is wrong."}
            </DialogDescription>
          </DialogHeader>
          <SMTPConnectionForm
            key={editing?.id ?? "new"}
            initial={initialForm}
            editing={Boolean(editing)}
            onSubmit={(form) => save.mutate(form)}
            footer={
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? <Spinner /> : null}
                  {editing ? "Check and save" : "Check and create"}
                </Button>
              </DialogFooter>
            }
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this sending account?"
        description={`"${deleteTarget?.name}" will be removed permanently. Anything set to send from it will need another account.`}
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
      />
    </>
  );
}
