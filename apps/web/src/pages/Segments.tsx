import { FormEvent, useEffect, useState } from "react";
import { Filter, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { api, type Segment } from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
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

type ConditionField = "tags" | "status" | "emailDomain";

interface Condition {
  field: ConditionField;
  // tags
  match: "ANY" | "ALL" | "NONE";
  values: string;
  // status
  status: "ACTIVE" | "UNSUBSCRIBED" | "BOUNCED";
  // emailDomain
  domain: string;
}

function emptyCondition(): Condition {
  return {
    field: "tags",
    match: "ANY",
    values: "",
    status: "ACTIVE",
    domain: ""
  };
}

function conditionToRule(condition: Condition): unknown | null {
  if (condition.field === "tags") {
    const values = condition.values
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (values.length === 0) {
      return null;
    }
    return { field: "tags", match: condition.match, values };
  }
  if (condition.field === "status") {
    return { field: "status", eq: condition.status };
  }
  if (!condition.domain.trim()) {
    return null;
  }
  return { field: "emailDomain", eq: condition.domain.trim() };
}

/** Build the rule tree from the flat condition list + AND/OR combinator. */
export function buildRules(
  conditions: Condition[],
  combinator: "AND" | "OR"
): unknown | null {
  const rules = conditions.map(conditionToRule).filter(Boolean);
  if (rules.length === 0) {
    return null;
  }
  if (rules.length === 1) {
    return rules[0];
  }
  return { op: combinator, rules };
}

export function Segments() {
  const { currentOrganizationId: organizationId } = useSession();
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [combinator, setCombinator] = useState<"AND" | "OR">("AND");
  const [conditions, setConditions] = useState<Condition[]>([emptyCondition()]);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Segment | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    if (!organizationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setSegments(await api.listSegments(organizationId));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load smart lists"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [organizationId]);

  function openDialog() {
    setName("");
    setCombinator("AND");
    setConditions([emptyCondition()]);
    setPreviewCount(null);
    setDialogOpen(true);
  }

  function updateCondition(index: number, patch: Partial<Condition>) {
    setConditions((current) =>
      current.map((condition, i) =>
        i === index ? { ...condition, ...patch } : condition
      )
    );
    setPreviewCount(null);
  }

  async function preview() {
    if (!organizationId) {
      return;
    }
    const rules = buildRules(conditions, combinator);
    if (!rules) {
      toast.error("Add at least one complete condition.");
      return;
    }
    try {
      const result = await api.previewSegmentRules({ organizationId, rules });
      setPreviewCount(result.count);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Preview failed");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) {
      toast.error("Select an organization in Settings first.");
      return;
    }
    const rules = buildRules(conditions, combinator);
    if (!rules) {
      toast.error("Add at least one complete condition.");
      return;
    }
    setSaving(true);
    try {
      await api.createSegment({ organizationId, name, rules });
      toast.success("Smart list saved.");
      setDialogOpen(false);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save smart list"
      );
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteSegment(deleteTarget.id);
      toast.success("Smart list deleted.");
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
        title="Smart lists"
        description="Audiences that update themselves — contacts are re-matched every time a campaign sends."
        actions={
          <Button onClick={openDialog} disabled={!organizationId}>
            <Plus className="h-4 w-4" />
            New smart list
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
          ) : segments.length === 0 ? (
            <EmptyState
              icon={Filter}
              title="No smart lists yet"
              description="Create a smart list to target a campaign at contacts matching tags, status, or email domain."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {segments.map((segment) => (
                  <TableRow key={segment.id}>
                    <TableCell className="font-medium">{segment.name}</TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTarget(segment)}
                          aria-label="Delete smart list"
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
            <DialogTitle>New smart list</DialogTitle>
            <DialogDescription>
              Contacts matching these rules are resolved fresh each time a
              campaign targeting this smart list sends.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="segment-name">Name</Label>
              <Input
                id="segment-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="segment-combinator">Match</Label>
              <select
                id="segment-combinator"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={combinator}
                onChange={(e) => {
                  setCombinator(e.target.value as "AND" | "OR");
                  setPreviewCount(null);
                }}
              >
                <option value="AND">All conditions (AND)</option>
                <option value="OR">Any condition (OR)</option>
              </select>
            </div>

            <div className="space-y-3">
              {conditions.map((condition, index) => (
                <div
                  key={index}
                  className="flex flex-wrap items-center gap-2 rounded-md border p-3"
                >
                  <select
                    aria-label="Condition field"
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                    value={condition.field}
                    onChange={(e) =>
                      updateCondition(index, {
                        field: e.target.value as ConditionField
                      })
                    }
                  >
                    <option value="tags">Tags</option>
                    <option value="status">Status</option>
                    <option value="emailDomain">Email domain</option>
                  </select>

                  {condition.field === "tags" && (
                    <>
                      <select
                        aria-label="Tag match"
                        className="h-9 rounded-md border bg-background px-2 text-sm"
                        value={condition.match}
                        onChange={(e) =>
                          updateCondition(index, {
                            match: e.target.value as Condition["match"]
                          })
                        }
                      >
                        <option value="ANY">has any</option>
                        <option value="ALL">has all</option>
                        <option value="NONE">has none</option>
                      </select>
                      <Input
                        aria-label="Tag values"
                        placeholder="vip, newsletter"
                        className="flex-1"
                        value={condition.values}
                        onChange={(e) =>
                          updateCondition(index, { values: e.target.value })
                        }
                      />
                    </>
                  )}

                  {condition.field === "status" && (
                    <select
                      aria-label="Status value"
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                      value={condition.status}
                      onChange={(e) =>
                        updateCondition(index, {
                          status: e.target.value as Condition["status"]
                        })
                      }
                    >
                      <option value="ACTIVE">Active</option>
                      <option value="UNSUBSCRIBED">Unsubscribed</option>
                      <option value="BOUNCED">Bounced</option>
                    </select>
                  )}

                  {condition.field === "emailDomain" && (
                    <Input
                      aria-label="Email domain"
                      placeholder="example.com"
                      className="flex-1"
                      value={condition.domain}
                      onChange={(e) =>
                        updateCondition(index, { domain: e.target.value })
                      }
                    />
                  )}

                  {conditions.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove condition"
                      onClick={() =>
                        setConditions((current) =>
                          current.filter((_, i) => i !== index)
                        )
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setConditions((current) => [...current, emptyCondition()])
                }
              >
                <Plus className="h-4 w-4" />
                Add condition
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <Button type="button" variant="secondary" onClick={preview}>
                <Users className="h-4 w-4" />
                Preview count
              </Button>
              {previewCount !== null && (
                <span className="text-sm text-muted-foreground">
                  {previewCount} matching contact
                  {previewCount === 1 ? "" : "s"}
                </span>
              )}
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
                Save smart list
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete smart list?"
        description={`${deleteTarget?.name} will no longer be available to target. Campaigns already sent are unaffected.`}
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </>
  );
}
