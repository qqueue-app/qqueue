import { useMemo, useState, type FormEvent } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, ShieldBan, Trash2 } from "lucide-react";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { api, type Suppression } from "../lib/api.js";
import { formatFullDate, formatMailDate } from "../lib/format.js";
import { qk } from "../lib/query-client.js";
import { useApiMutation, useOrgQuery } from "../lib/use-api.js";
import { useSession } from "../lib/session-context.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { DataGrid } from "../components/ui/data-grid.js";
import { RowActions } from "../components/ui/row-actions.js";
import { Hint } from "../components/ui/tooltip.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Spinner } from "../components/ui/spinner.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";

/**
 * Why an address ended up blocked, in words rather than the enum name. People
 * reading this page are deciding whether it is safe to unblock someone, and
 * "BOUNCE" alone doesn't tell them that.
 */
const REASONS: Record<
  string,
  { label: string; hint: string; variant: "destructive" | "secondary" | "outline" }
> = {
  BOUNCE: {
    label: "Bounced",
    hint: "Mail to this address kept failing, so QQueue stopped trying.",
    variant: "destructive",
  },
  COMPLAINT: {
    label: "Marked as spam",
    hint: "This person reported one of your emails as spam.",
    variant: "destructive",
  },
  UNSUBSCRIBE: {
    label: "Unsubscribed",
    hint: "This person asked to stop receiving your email.",
    variant: "secondary",
  },
  MANUAL: {
    label: "Added by you",
    hint: "Someone on your team blocked this address by hand.",
    variant: "outline",
  },
};

function reasonOf(reason: string) {
  return (
    REASONS[reason] ?? {
      label: reason,
      hint: "Blocked by QQueue.",
      variant: "outline" as const,
    }
  );
}

export function Suppressions() {
  const { currentOrganizationId: organizationId, currentOrganization } =
    useSession();
  // Un-suppressing is OWNER/ADMIN on the API; hide the control from members.
  // Blocking an address stays open to every member.
  const canUnblock =
    currentOrganization?.role === "OWNER" ||
    currentOrganization?.role === "ADMIN";

  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Suppression | null>(null);

  const suppressionsQuery = useOrgQuery(
    organizationId,
    qk.suppressions(organizationId ?? ""),
    (id) => api.listSuppressions(id)
  );

  const block = useApiMutation(
    () =>
      api.addSuppression({
        organizationId: organizationId as string,
        email,
        reason: "MANUAL",
      }),
    {
      successMessage: "Address blocked.",
      errorMessage: "Couldn't block that address.",
      invalidates: [qk.suppressions(organizationId ?? "")],
      onSuccess: () => {
        setDialogOpen(false);
        setEmail("");
      },
    }
  );

  const unblock = useApiMutation(
    (suppression: Suppression) => api.deleteSuppression(suppression.id),
    {
      successMessage: "Address unblocked — it can be emailed again.",
      errorMessage: "Couldn't unblock that address.",
      invalidates: [qk.suppressions(organizationId ?? "")],
      onSuccess: () => setDeleteTarget(null),
    }
  );

  const columns = useMemo<ColumnDef<Suppression, unknown>[]>(
    () => [
      {
        accessorKey: "email",
        header: "Address",
        meta: { title: "Address" },
        cell: ({ getValue }) => (
          <span className="font-medium">{String(getValue())}</span>
        ),
      },
      {
        accessorKey: "reason",
        header: "Why",
        meta: { title: "Why" },
        cell: ({ getValue }) => {
          const reason = reasonOf(String(getValue()));
          return (
            <Hint label={reason.hint}>
              <Badge variant={reason.variant} className="cursor-help">
                {reason.label}
              </Badge>
            </Hint>
          );
        },
      },
      {
        accessorKey: "createdAt",
        header: "Blocked",
        meta: { title: "Blocked", hideBelowMd: true },
        cell: ({ getValue }) => (
          <Hint label={formatFullDate(String(getValue()))}>
            <span className="cursor-help text-muted-foreground">
              {formatMailDate(String(getValue()))}
            </span>
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
            rowLabel={row.original.email}
            actions={[
              {
                label: "Unblock this address",
                icon: Trash2,
                primary: true,
                destructive: true,
                hidden: !canUnblock,
                onSelect: () => setDeleteTarget(row.original),
              },
            ]}
          />
        ),
      },
    ],
    [canUnblock]
  );

  return (
    <>
      <PageHeader
        title="Blocked addresses"
        description="Addresses QQueue will never email, across every send. Bounces, spam reports, and unsubscribes land here on their own."
        actions={
          <Button
            onClick={() => {
              setEmail("");
              setDialogOpen(true);
            }}
            disabled={!organizationId}
          >
            <Plus className="h-4 w-4" />
            Block an address
          </Button>
        }
      />

      <section className="p-4 sm:p-6">
        <DataGrid
          label="Blocked addresses"
          data={suppressionsQuery.data ?? []}
          columns={columns}
          getRowId={(row) => row.id}
          loading={suppressionsQuery.isPending}
          searchPlaceholder="Search blocked addresses…"
          empty={
            <EmptyState
              icon={ShieldBan}
              title="Nothing blocked"
              description="Bounces, spam reports, and unsubscribes land here on their own. You can also block an address by hand."
            />
          }
          noResults={
            <EmptyState
              icon={ShieldBan}
              title="No matching addresses"
              description="Try a different search."
            />
          }
          renderMobileRow={(suppression) => {
            const reason = reasonOf(suppression.reason);
            return (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {suppression.email}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant={reason.variant}>{reason.label}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatMailDate(suppression.createdAt)}
                    </span>
                  </div>
                </div>
                {canUnblock ? (
                  <RowActions
                    rowLabel={suppression.email}
                    actions={[
                      {
                        label: "Unblock this address",
                        icon: Trash2,
                        primary: true,
                        destructive: true,
                        onSelect: () => setDeleteTarget(suppression),
                      },
                    ]}
                  />
                ) : null}
              </div>
            );
          }}
        />
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Block an address</DialogTitle>
            <DialogDescription>
              QQueue will skip this address on every campaign, automated, and
              manual send until you unblock it.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              block.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="suppress-email">Email address</Label>
              <Input
                id="suppress-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="someone@example.com"
                autoFocus
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={block.isPending}>
                {block.isPending ? <Spinner /> : null}
                Block
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Unblock this address?"
        description={`${deleteTarget?.email} will start receiving your email again.`}
        confirmLabel="Unblock"
        loading={unblock.isPending}
        onConfirm={() => deleteTarget && unblock.mutate(deleteTarget)}
      />
    </>
  );
}
