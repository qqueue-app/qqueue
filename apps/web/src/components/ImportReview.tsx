import { Pencil } from "lucide-react";
import type {
  ContactImportDuplicate,
  ContactImportOverride,
  ContactImportPreview,
  ContactImportResolution
} from "../lib/api.js";
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";
import { Label } from "./ui/label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "./ui/select.js";

const RESOLUTION_LABELS: Record<ContactImportResolution, string> = {
  MERGE: "Merge",
  REPLACE: "Replace",
  KEEP: "Keep existing",
  SKIP: "Skip"
};

const RESOLUTION_HELP: Record<ContactImportResolution, string> = {
  MERGE:
    "Takes the names from the file where it has them and adds its tags to the existing ones. A blank column leaves what's already there.",
  REPLACE:
    "Overwrites names and tags with what's in the file, clearing anything the file leaves blank.",
  KEEP: "Leaves the contact exactly as it is. It still joins the list, if you chose one.",
  SKIP: "Leaves the contact alone and drops the row from this import entirely."
};

interface ProjectedContact {
  firstName?: string;
  lastName?: string;
  tags: string[];
}

/**
 * What the contact will look like after the import, given the chosen
 * resolution. Showing the projection rather than the raw CSV values is the point
 * of the review: "merge" and "replace" produce visibly different results from
 * the same row, and a stale-looking diff would send people to the wrong choice.
 */
function project(
  duplicate: ContactImportDuplicate,
  resolution: ContactImportResolution,
  override: ContactImportOverride | undefined
): ProjectedContact {
  const existing: ProjectedContact = {
    firstName: duplicate.existing.firstName ?? undefined,
    lastName: duplicate.existing.lastName ?? undefined,
    tags: duplicate.existing.tags
  };

  if (resolution === "KEEP" || resolution === "SKIP") {
    return existing;
  }

  const incoming: ProjectedContact = {
    firstName: override?.firstName ?? duplicate.incoming.firstName,
    lastName: override?.lastName ?? duplicate.incoming.lastName,
    tags: override?.tags ?? duplicate.incoming.tags
  };

  if (resolution === "REPLACE") {
    return incoming;
  }

  return {
    firstName: incoming.firstName || existing.firstName,
    lastName: incoming.lastName || existing.lastName,
    tags: Array.from(new Set([...existing.tags, ...incoming.tags]))
  };
}

function displayName(contact: ProjectedContact) {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  return name || "—";
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-control border bg-muted/30 px-3 py-2">
      <div className="text-title font-semibold tabular-nums">{value}</div>
      <div className="text-meta text-muted-foreground">{label}</div>
    </div>
  );
}

interface ImportReviewProps {
  preview: ContactImportPreview;
  defaultResolution: ContactImportResolution;
  onDefaultResolutionChange: (value: ContactImportResolution) => void;
  overrides: Record<string, ContactImportOverride>;
  onOverride: (email: string, patch: ContactImportOverride) => void;
  resolutionFor: (email: string) => ContactImportResolution;
  /** Email of the duplicate currently open for inline editing, if any. */
  editing: string | null;
  onEditingChange: (email: string | null) => void;
}

/**
 * The dry-run review shown between choosing a CSV and committing it: what the
 * file contains, which contacts it collides with, and what to do about each one.
 */
export function ImportReview({
  preview,
  defaultResolution,
  onDefaultResolutionChange,
  overrides,
  onOverride,
  resolutionFor,
  editing,
  onEditingChange
}: ImportReviewProps) {
  const hasDuplicates = preview.duplicateCount > 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat value={preview.newCount} label="New contacts" />
        <Stat value={preview.duplicateCount} label="Already exist" />
        <Stat value={preview.suppressedCount} label="Suppressed" />
        <Stat value={preview.errors.length} label="Unreadable rows" />
      </div>

      {preview.contactList ? (
        <p className="text-body text-muted-foreground">
          Everyone imported joins{" "}
          <span className="font-medium text-foreground">
            {preview.contactList.name}
          </span>
          {preview.contactList.willCreate ? " (a new list)" : ""}.
        </p>
      ) : null}

      {preview.collapsedInFile > 0 ? (
        <p className="text-body text-muted-foreground">
          {preview.collapsedInFile} row
          {preview.collapsedInFile === 1 ? "" : "s"} repeated an address already
          in the file — those were combined into one contact each.
        </p>
      ) : null}

      {preview.suppressedCount > 0 ? (
        <p className="text-body text-muted-foreground">
          Suppressed addresses are still imported, but they stay suppressed and
          won&apos;t be emailed.
        </p>
      ) : null}

      {hasDuplicates ? (
        <div className="space-y-3 border-t pt-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <Label htmlFor="defaultResolution">
                What to do with contacts you already have
              </Label>
              <p className="text-meta text-muted-foreground">
                {RESOLUTION_HELP[defaultResolution]}
              </p>
            </div>
            <Select
              value={defaultResolution}
              onValueChange={(value) =>
                onDefaultResolutionChange(value as ContactImportResolution)
              }
            >
              <SelectTrigger id="defaultResolution" className="w-field-choice">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  Object.keys(RESOLUTION_LABELS) as ContactImportResolution[]
                ).map((value) => (
                  <SelectItem key={value} value={value}>
                    {RESOLUTION_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ul className="divide-y rounded-control border">
            {preview.duplicates.map((duplicate) => {
              const key = duplicate.email.toLowerCase();
              const override = overrides[key];
              const resolution = resolutionFor(duplicate.email);
              const after = project(duplicate, resolution, override);
              const before: ProjectedContact = {
                firstName: duplicate.existing.firstName ?? undefined,
                lastName: duplicate.existing.lastName ?? undefined,
                tags: duplicate.existing.tags
              };
              const noChange =
                displayName(before) === displayName(after) &&
                [...before.tags].sort().join() === [...after.tags].sort().join();
              const isEditing = editing === duplicate.email;

              return (
                <li key={key} className="space-y-2 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-field">
                        <span className="truncate text-body font-medium">
                          {duplicate.email}
                        </span>
                        {duplicate.suppressed ? (
                          <Badge variant="destructive">Suppressed</Badge>
                        ) : null}
                        {duplicate.existing.status !== "ACTIVE" ? (
                          <Badge variant="secondary">
                            {duplicate.existing.status.toLowerCase()}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-field">
                      <Select
                        value={resolution}
                        onValueChange={(value) =>
                          onOverride(duplicate.email, {
                            resolution: value as ContactImportResolution
                          })
                        }
                      >
                        <SelectTrigger
                          className="h-8 w-field-choice"
                          aria-label={`What to do with ${duplicate.email}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(
                            Object.keys(
                              RESOLUTION_LABELS
                            ) as ContactImportResolution[]
                          ).map((value) => (
                            <SelectItem key={value} value={value}>
                              {RESOLUTION_LABELS[value]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Edit ${duplicate.email}`}
                        onClick={() =>
                          onEditingChange(isEditing ? null : duplicate.email)
                        }
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-2 text-meta sm:grid-cols-2">
                    <div className="rounded border bg-muted/30 px-2 py-field">
                      <div className="text-muted-foreground">Now</div>
                      <div className="font-medium">{displayName(before)}</div>
                      <div className="text-muted-foreground">
                        {before.tags.join(", ") || "no tags"}
                      </div>
                    </div>
                    <div
                      className={
                        noChange
                          ? "rounded border bg-muted/30 px-2 py-field"
                          : "rounded border border-primary/40 bg-primary/5 px-2 py-field"
                      }
                    >
                      <div className="text-muted-foreground">
                        {noChange ? "Unchanged" : "After import"}
                      </div>
                      <div className="font-medium">{displayName(after)}</div>
                      <div className="text-muted-foreground">
                        {after.tags.join(", ") || "no tags"}
                      </div>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="grid gap-2 rounded border bg-muted/20 p-2 sm:grid-cols-3">
                      <div className="space-y-1">
                        <Label
                          className="text-meta"
                          htmlFor={`first-${key}`}
                        >
                          First name
                        </Label>
                        <Input
                          id={`first-${key}`}
                          className="h-8"
                          value={
                            override?.firstName ??
                            duplicate.incoming.firstName ??
                            ""
                          }
                          onChange={(event) =>
                            onOverride(duplicate.email, {
                              firstName: event.target.value
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-meta" htmlFor={`last-${key}`}>
                          Last name
                        </Label>
                        <Input
                          id={`last-${key}`}
                          className="h-8"
                          value={
                            override?.lastName ??
                            duplicate.incoming.lastName ??
                            ""
                          }
                          onChange={(event) =>
                            onOverride(duplicate.email, {
                              lastName: event.target.value
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-meta" htmlFor={`tags-${key}`}>
                          Tags
                        </Label>
                        <Input
                          id={`tags-${key}`}
                          className="h-8"
                          placeholder="comma separated"
                          value={(
                            override?.tags ?? duplicate.incoming.tags
                          ).join(", ")}
                          onChange={(event) =>
                            onOverride(duplicate.email, {
                              tags: event.target.value
                                .split(",")
                                .map((tag) => tag.trim())
                                .filter(Boolean)
                            })
                          }
                        />
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {preview.duplicatesTruncated ? (
            <p className="text-meta text-muted-foreground">
              Showing the first {preview.duplicates.length} of{" "}
              {preview.duplicateCount} existing contacts. The remaining{" "}
              {preview.duplicateCount - preview.duplicates.length} are imported
              using the choice above.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="border-t pt-4 text-body text-muted-foreground">
          None of these contacts exist yet — nothing will be overwritten.
        </p>
      )}

      {preview.newSample.length > 0 ? (
        <details className="border-t pt-4 text-body">
          <summary className="cursor-pointer text-muted-foreground">
            Preview the new contacts
          </summary>
          <ul className="mt-2 space-y-1 text-meta text-muted-foreground">
            {preview.newSample.map((row) => (
              <li key={row.email}>
                <span className="text-foreground">{row.email}</span>
                {row.firstName || row.lastName
                  ? ` — ${[row.firstName, row.lastName].filter(Boolean).join(" ")}`
                  : ""}
                {row.tags.length ? ` (${row.tags.join(", ")})` : ""}
              </li>
            ))}
            {preview.newCount > preview.newSample.length ? (
              <li>
                …and {preview.newCount - preview.newSample.length} more.
              </li>
            ) : null}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
