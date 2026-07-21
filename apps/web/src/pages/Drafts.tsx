import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileEdit, PenSquare, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { api, type EmailDraft } from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { Button } from "../components/ui/button.js";
import { Card } from "../components/ui/card.js";
import { Skeleton } from "../components/ui/skeleton.js";

function formatUpdated(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit"
  });
}

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
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<EmailDraft | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!organizationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setDrafts(await api.listEmailDrafts(organizationId));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't load your drafts."
      );
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmDelete() {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    try {
      await api.deleteEmailDraft(deleteTarget.id);
      setDrafts((current) =>
        current.filter((draft) => draft.id !== deleteTarget.id)
      );
      setDeleteTarget(null);
      toast.success("Draft deleted.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't delete the draft."
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Drafts"
        description="Unfinished emails, saved automatically as you write. Open one to pick up where you left off."
        actions={
          <Button type="button" onClick={() => navigate("/email-studio")}>
            <PenSquare className="h-4 w-4" />
            New email
          </Button>
        }
      />

      <section className="p-5 sm:p-6">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : drafts.length === 0 ? (
          <Card className="p-2">
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
          </Card>
        ) : (
          <div className="space-y-2">
            {drafts.map((draft) => (
              <Card
                key={draft.id}
                className="flex items-center gap-3 p-4 transition-colors hover:bg-accent/40"
              >
                <button
                  type="button"
                  // The composer owns draft loading, so the page just hands it
                  // the id and lets it restore attachments and everything else.
                  onClick={() => navigate(`/email-studio?draft=${draft.id}`)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate font-medium">
                    {draft.subject || "(no subject)"}
                  </div>
                  <div className="mt-0.5 truncate text-sm text-muted-foreground">
                    {describeRecipients(draft)}
                  </div>
                </button>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                  Edited {formatUpdated(draft.updatedAt)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete draft ${draft.subject || "(no subject)"}`}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => setDeleteTarget(draft)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </Card>
            ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete draft?"
        description="This draft will be permanently removed."
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </>
  );
}
