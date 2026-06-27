import { FormEvent, useEffect, useState } from "react";
import { Plus, ShieldBan, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { api, type Suppression } from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Badge } from "../components/ui/badge.js";
import { Spinner } from "../components/ui/spinner.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { Card } from "../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../components/ui/dialog.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../components/ui/table.js";

function formatDate(value?: string) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
      });
}

function reasonVariant(reason: string) {
  if (reason === "COMPLAINT" || reason === "BOUNCE") return "destructive" as const;
  if (reason === "UNSUBSCRIBE") return "secondary" as const;
  return "outline" as const;
}

export function Suppressions() {
  const { currentOrganizationId: organizationId } = useSession();
  const [suppressions, setSuppressions] = useState<Suppression[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Suppression | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    if (!organizationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setSuppressions(await api.listSuppressions(organizationId));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load suppressions"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [organizationId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) {
      toast.error("Select an organization in Settings first.");
      return;
    }
    setSaving(true);
    try {
      await api.addSuppression({ organizationId, email, reason: "MANUAL" });
      toast.success("Address blocked.");
      setDialogOpen(false);
      setEmail("");
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to block address"
      );
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteSuppression(deleteTarget.id);
      toast.success("Address unblocked. It can be emailed again.");
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to remove.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Blocked addresses"
        description="Addresses QQueue will never email, across every send. Bounces, complaints, and unsubscribes land here automatically."
        actions={
          <Button
            onClick={() => {
              setEmail("");
              setDialogOpen(true);
            }}
            disabled={!organizationId}
          >
            <Plus className="h-4 w-4" />
            Block address
          </Button>
        }
      />

      <section className="p-6">
        <Card className="overflow-hidden">
          {loading ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : suppressions.length === 0 ? (
            <EmptyState
              icon={ShieldBan}
              title="Nothing blocked"
              description="Bounces, complaints, and unsubscribes land here automatically. You can also add an address manually."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppressions.map((suppression) => (
                  <TableRow key={suppression.id}>
                    <TableCell className="font-medium">
                      {suppression.email}
                    </TableCell>
                    <TableCell>
                      <Badge variant={reasonVariant(suppression.reason)}>
                        {suppression.reason}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(suppression.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTarget(suppression)}
                          aria-label="Unblock address"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Block an address</DialogTitle>
            <DialogDescription>
              The address will be skipped on every campaign, transactional, and
              manual send until you remove it.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="suppress-email">Email</Label>
              <Input
                id="suppress-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
              <Button type="submit" disabled={saving}>
                {saving ? <Spinner /> : null}
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
        description={`${deleteTarget?.email} will be eligible to receive email again.`}
        confirmLabel="Unblock"
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </>
  );
}
