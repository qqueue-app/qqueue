import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { FileEdit, PenSquare, Trash2 } from "lucide-react";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { api, type EmailDraft } from "../lib/api.js";
import { formatFullDate, formatMailDate } from "../lib/format.js";
import { qk } from "../lib/query-client.js";
import { useApiMutation, useOrgQuery } from "../lib/use-api.js";
import { useSession } from "../lib/session-context.js";
import { Button } from "../components/ui/button.js";
import { DataGrid } from "../components/ui/data-grid.js";
import { RowActions } from "../components/ui/row-actions.js";
import { Hint } from "../components/ui/tooltip.js";

function describeRecipients(draft: EmailDraft) {
  const people = [...draft.to, ...draft.cc, ...draft.bcc];
  if (people.length > 0) {
    const shown = people.slice(0, 3).join(", ");
    return people.length > 3 ? `${shown} +${people.length - 3} more` : shown;
  }
  if (draft.listIds.length > 0) {
    return draft.listIds.length === 1
      ? "1 contact list"
      : `${draft.listIds.length} contact lists`;
  }
  return "No recipients yet";
}

export function Drafts() {
  const { currentOrganizationId: organizationId } = useSession();
  const navigate = useNavigate();
  const [deleteTarget, setDeleteTarget] = useState<EmailDraft | null>(null);

  const draftsQuery = useOrgQuery(
    organizationId,
    qk.drafts(organizationId ?? ""),
    (id) => api.listEmailDrafts(id)
  );

  const remove = useApiMutation(
    (draft: EmailDraft) => api.deleteEmailDraft(draft.id),
    {
      successMessage: "Draft deleted.",
      errorMessage: "Couldn't delete that draft.",
      invalidates: [qk.drafts(organizationId ?? "")],
      onSuccess: () => setDeleteTarget(null),
    }
  );

  // The composer owns draft loading, so this page just hands it an id and lets
  // it restore recipients, attachments, and the rest.
  function openDraft(draft: EmailDraft) {
    navigate(`/email-studio?draft=${draft.id}`);
  }

  const columns = useMemo<ColumnDef<EmailDraft, unknown>[]>(
    () => [
      {
        accessorKey: "subject",
        header: "Subject",
        meta: { title: "Subject" },
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.subject || "(no subject)"}
          </span>
        ),
      },
      {
        id: "recipients",
        accessorFn: (row) => [...row.to, ...row.cc, ...row.bcc].join(", "),
        header: "To",
        meta: { title: "To", hideBelowMd: true },
        cell: ({ row }) => (
          <span className="block max-w-sm truncate text-muted-foreground">
            {describeRecipients(row.original)}
          </span>
        ),
      },
      {
        accessorKey: "updatedAt",
        header: "Last edited",
        meta: { title: "Last edited" },
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
            rowLabel={row.original.subject || "this draft"}
            actions={[
              {
                label: "Keep writing",
                icon: PenSquare,
                primary: true,
                onSelect: () => openDraft(row.original),
              },
              {
                label: "Delete draft",
                icon: Trash2,
                destructive: true,
                onSelect: () => setDeleteTarget(row.original),
              },
            ]}
          />
        ),
      },
    ],
    // openDraft closes over a stable navigate reference.
    []
  );

  return (
    <>
      <PageHeader
        title="Drafts"
        description="Unfinished emails, saved as you write. Open one to pick up where you left off."
        actions={
          <Button type="button" onClick={() => navigate("/email-studio")}>
            <PenSquare className="h-4 w-4" />
            New email
          </Button>
        }
      />

      <section className="p-4 sm:p-6">
        <DataGrid
          label="Drafts"
          data={draftsQuery.data ?? []}
          columns={columns}
          getRowId={(row) => row.id}
          loading={draftsQuery.isPending}
          onRowClick={openDraft}
          searchPlaceholder="Search drafts…"
          empty={
            <EmptyState
              icon={FileEdit}
              title="No drafts yet"
              description="Anything you start writing in the composer is saved here automatically."
              action={
                <Button type="button" onClick={() => navigate("/email-studio")}>
                  <PenSquare className="h-4 w-4" />
                  Write an email
                </Button>
              }
            />
          }
          noResults={
            <EmptyState
              icon={FileEdit}
              title="No matching drafts"
              description="Try a different search."
            />
          }
          renderMobileRow={(draft) => (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {draft.subject || "(no subject)"}
                </div>
                <div className="truncate text-sm text-muted-foreground">
                  {describeRecipients(draft)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Edited {formatMailDate(draft.updatedAt)}
                </div>
              </div>
              <RowActions
                rowLabel={draft.subject || "this draft"}
                actions={[
                  {
                    label: "Delete draft",
                    icon: Trash2,
                    primary: true,
                    destructive: true,
                    onSelect: () => setDeleteTarget(draft),
                  },
                ]}
              />
            </div>
          )}
        />
      </section>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this draft?"
        description="It will be removed permanently."
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
      />
    </>
  );
}
