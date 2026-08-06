import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Activity,
  Download,
  ListPlus,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  Users
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { ImportReview } from "../components/ImportReview.js";
import {
  api,
  type Contact,
  type ContactActivityEvent,
  type ContactImportOverride,
  type ContactImportPreview,
  type ContactImportResolution,
  type ContactList
} from "../lib/api.js";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../components/ui/select.js";
import { Avatar } from "../components/ui/avatar.js";
import { DataGrid } from "../components/ui/data-grid.js";
import { RowActions } from "../components/ui/row-actions.js";
import { Hint } from "../components/ui/tooltip.js";

function parseFilterTags(value: string) {
  return [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))];
}

interface ContactForm {
  email: string;
  firstName: string;
  lastName: string;
  tags: string;
}

const emptyForm: ContactForm = {
  email: "",
  firstName: "",
  lastName: "",
  tags: ""
};

function parseTags(value: string) {
  return [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))];
}

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

function statusVariant(status: string) {
  if (status === "ACTIVE") return "success" as const;
  if (status === "BOUNCED") return "destructive" as const;
  return "secondary" as const;
}

/** What each status actually means for whether this person receives mail. */
function statusHint(status: string) {
  if (status === "ACTIVE") return "Receiving your email normally.";
  if (status === "BOUNCED")
    return "Mail to this address kept failing, so QQueue stopped sending to it.";
  if (status === "UNSUBSCRIBED")
    return "This person asked to stop receiving your email.";
  return "Not currently receiving your email.";
}

export function Contacts() {
  const { currentOrganizationId: organizationId } = useSession();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [form, setForm] = useState<ContactForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);

  // CSV import/export.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importTarget, setImportTarget] = useState<"none" | "existing" | "new">(
    "none"
  );
  const [importListId, setImportListId] = useState("");
  const [importListName, setImportListName] = useState("");
  const [importErrors, setImportErrors] = useState<
    { row: number; message: string }[]
  >([]);
  const [lists, setLists] = useState<ContactList[]>([]);

  // Import review. The file is dry-run first so collisions with existing
  // contacts are a decision instead of a silent merge; nothing is written until
  // the review step is confirmed.
  const [importStep, setImportStep] = useState<"options" | "review">("options");
  const [importPreview, setImportPreview] =
    useState<ContactImportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [defaultResolution, setDefaultResolution] =
    useState<ContactImportResolution>("MERGE");
  // Sparse: only duplicates the user decided individually or edited in place.
  const [overrides, setOverrides] = useState<
    Record<string, ContactImportOverride>
  >({});
  const [editingDuplicate, setEditingDuplicate] = useState<string | null>(null);

  // Bulk selection for delete.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [clearGridSelection, setClearGridSelection] = useState<
    (() => void) | null
  >(null);

  // Tag-driven segment filter.
  const [filterTags, setFilterTags] = useState("");
  const [filterMatch, setFilterMatch] = useState<"ANY" | "ALL">("ANY");
  const [segmentCount, setSegmentCount] = useState<number | null>(null);
  const [segmentLoading, setSegmentLoading] = useState(false);
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [creatingList, setCreatingList] = useState(false);

  // Activity drawer.
  const [activityContact, setActivityContact] = useState<Contact | null>(null);
  const [activity, setActivity] = useState<ContactActivityEvent[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  // Searching, sorting, selection, and paging all live in the DataGrid now, so
  // this page only owns the things the grid can't know about: the tag segment
  // builder, CSV import, and the activity drawer.
  const contactColumns = useMemo<ColumnDef<Contact, unknown>[]>(
    () => [
      {
        accessorKey: "email",
        header: "Email",
        meta: { title: "Email" },
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar
              name={
                [row.original.firstName, row.original.lastName]
                  .filter(Boolean)
                  .join(" ") || row.original.email
              }
              size="sm"
            />
            <span className="truncate font-medium">{row.original.email}</span>
          </div>
        ),
      },
      {
        id: "name",
        accessorFn: (row) =>
          [row.firstName, row.lastName].filter(Boolean).join(" "),
        header: "Name",
        meta: { title: "Name", hideBelowMd: true },
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">
            {String(getValue()) || "—"}
          </span>
        ),
      },
      {
        id: "tags",
        accessorFn: (row) => (row.tags ?? []).join(" "),
        header: "Tags",
        meta: { title: "Tags", hideBelowLg: true },
        enableSorting: false,
        cell: ({ row }) =>
          row.original.tags && row.original.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {row.original.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="font-normal">
                  {tag}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "status",
        header: "Status",
        meta: { title: "Status" },
        cell: ({ row }) => (
          <Hint label={statusHint(row.original.status)}>
            <Badge
              variant={statusVariant(row.original.status)}
              className="cursor-help"
            >
              {row.original.status}
            </Badge>
          </Hint>
        ),
      },
      {
        accessorKey: "createdAt",
        header: "Added",
        meta: { title: "Added", hideBelowLg: true },
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">
            {formatDate(getValue() as string)}
          </span>
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
                label: "See what this person has done",
                icon: Activity,
                primary: true,
                onSelect: () => void openActivity(row.original),
              },
              {
                label: "Edit this contact",
                icon: Pencil,
                onSelect: () => openEdit(row.original),
              },
              {
                label: "Delete this contact",
                icon: Trash2,
                destructive: true,
                onSelect: () => setDeleteTarget(row.original),
              },
            ]}
          />
        ),
      },
    ],
    // The handlers referenced above are stable for the life of the page.
    []
  );

  async function load() {
    if (!organizationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setContacts(await api.listContacts(organizationId));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load contacts"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    void loadLists();
    // Selection is by id and can't survive an org switch.
    setSelectedIds(new Set());
  }, [organizationId]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEdit(contact: Contact) {
    setEditing(contact);
    setForm({
      email: contact.email,
      firstName: contact.firstName ?? "",
      lastName: contact.lastName ?? "",
      tags: (contact.tags ?? []).join(", ")
    });
    setDialogOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) {
      toast.error("Select an organization in Settings first.");
      return;
    }

    const payload = {
      organizationId,
      email: form.email,
      firstName: form.firstName || undefined,
      lastName: form.lastName || undefined,
      tags: parseTags(form.tags)
    };

    setSaving(true);
    try {
      if (editing) {
        await api.updateContact(editing.id, payload);
        toast.success("Contact updated.");
      } else {
        await api.createContact(payload);
        toast.success("Contact added.");
      }
      setDialogOpen(false);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save contact"
      );
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteContact(deleteTarget.id);
      toast.success("Contact removed.");
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete.");
    } finally {
      setDeleting(false);
    }
  }

  function handleImportFileSelected(event: FormEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Reset so selecting the same file again still fires onChange.
    input.value = "";
    if (!file) {
      return;
    }
    setImportFile(file);
    setImportDialogOpen(true);
  }

  /** The list target chosen in the options step, in API shape. */
  function importListTarget() {
    return {
      contactListId:
        importTarget === "existing" ? importListId || undefined : undefined,
      contactListName:
        importTarget === "new" ? importListName.trim() || undefined : undefined
    };
  }

  async function runPreview(event: FormEvent) {
    event.preventDefault();
    if (!importFile || !organizationId) {
      return;
    }

    setPreviewing(true);
    setImportErrors([]);
    try {
      const preview = await api.previewImportContacts(importFile, {
        organizationId,
        ...importListTarget()
      });
      setImportPreview(preview);
      setOverrides({});
      setEditingDuplicate(null);
      setImportStep("review");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to read that CSV"
      );
    } finally {
      setPreviewing(false);
    }
  }

  async function runImport() {
    if (!importFile || !organizationId) {
      return;
    }

    setImporting(true);
    setImportErrors([]);
    try {
      // The contact record always dedupes org-wide on email; the list target
      // only adds a membership. So importing the same CSV into two lists gives
      // one contact in both, never a duplicate.
      const summary = await api.importContacts(importFile, {
        organizationId,
        ...importListTarget(),
        defaultResolution,
        overrides
      });

      const parts = [`${summary.created} added`];
      if (summary.updated > 0) parts.push(`${summary.updated} updated`);
      if (summary.unchanged > 0) parts.push(`${summary.unchanged} left as-is`);
      if (summary.suppressed > 0) parts.push(`${summary.suppressed} suppressed`);
      if (summary.skipped > 0) parts.push(`${summary.skipped} unreadable`);
      const where = summary.contactList
        ? ` into ${summary.contactList.name}${summary.contactList.created ? " (new list)" : ""}`
        : "";
      toast.success(`Import complete${where}: ${parts.join(", ")}.`);

      // Keep the dialog open when rows failed so the reasons stay readable —
      // previously these were parsed server-side and then thrown away.
      if (summary.errors.length > 0) {
        setImportErrors(summary.errors);
      } else {
        closeImportDialog();
      }
      await load();
      await loadLists();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to import contacts"
      );
    } finally {
      setImporting(false);
    }
  }

  /** Merge a partial decision into one duplicate's override entry. */
  function setOverride(email: string, patch: ContactImportOverride) {
    const key = email.toLowerCase();
    setOverrides((current) => ({
      ...current,
      [key]: { ...current[key], ...patch }
    }));
  }

  function resolutionFor(email: string): ContactImportResolution {
    return overrides[email.toLowerCase()]?.resolution ?? defaultResolution;
  }

  function closeImportDialog() {
    setImportDialogOpen(false);
    setImportFile(null);
    setImportErrors([]);
    setImportListName("");
    setImportStep("options");
    setImportPreview(null);
    setOverrides({});
    setDefaultResolution("MERGE");
    setEditingDuplicate(null);
  }

  async function loadLists() {
    if (!organizationId) return;
    try {
      // Coalesce to an array: the import dialog's children are evaluated even
      // while it is closed, so a non-array here would break the whole page.
      setLists((await api.listContactLists(organizationId)) ?? []);
    } catch {
      // Non-fatal: the import dialog falls back to "don't add to a list".
    }
  }

  /**
   * The grid owns which rows are ticked; this page only holds the set long
   * enough to confirm the delete. `clearGridSelection` is the grid's own reset,
   * captured when the bulk action fires so the tick marks clear once the rows
   * they referred to are gone.
   */
  async function confirmBulkDelete() {
    if (!organizationId || selectedIds.size === 0) return;
    setBulkDeleting(true);
    try {
      const { deleted } = await api.bulkDeleteContacts(
        organizationId,
        Array.from(selectedIds)
      );
      toast.success(`${deleted} contact${deleted === 1 ? "" : "s"} removed.`);
      clearGridSelection?.();
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete.");
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handleExport() {
    if (!organizationId) {
      return;
    }
    setExporting(true);
    try {
      const csv = await api.exportContacts(organizationId);
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" })
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "contacts.csv";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to export contacts"
      );
    } finally {
      setExporting(false);
    }
  }

  // Live segment preview: re-count matching contacts as the filter changes.
  useEffect(() => {
    const tags = parseFilterTags(filterTags);
    if (!organizationId || tags.length === 0) {
      setSegmentCount(null);
      return;
    }
    let cancelled = false;
    setSegmentLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.previewSegment({
          organizationId,
          tags,
          match: filterMatch
        });
        if (!cancelled) setSegmentCount(result.count);
      } catch {
        if (!cancelled) setSegmentCount(null);
      } finally {
        if (!cancelled) setSegmentLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [organizationId, filterTags, filterMatch]);

  async function createListFromSegment(event: FormEvent) {
    event.preventDefault();
    const tags = parseFilterTags(filterTags);
    if (!organizationId || tags.length === 0) {
      return;
    }
    setCreatingList(true);
    try {
      await api.createListFromSegment({
        organizationId,
        name: newListName,
        tags,
        match: filterMatch
      });
      toast.success("List created from filter.");
      setListDialogOpen(false);
      setNewListName("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to create list"
      );
    } finally {
      setCreatingList(false);
    }
  }

  async function openActivity(contact: Contact) {
    setActivityContact(contact);
    setActivity([]);
    setActivityLoading(true);
    try {
      const result = await api.getContactActivity(contact.id);
      setActivity(result.events);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load activity"
      );
    } finally {
      setActivityLoading(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Contacts"
        description="Store contacts and list memberships."
        actions={
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleImportFileSelected}
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={!organizationId || importing}
            >
              {importing ? <Spinner /> : <Upload className="h-4 w-4" />}
              Import
            </Button>
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={!organizationId || exporting}
            >
              {exporting ? <Spinner /> : <Download className="h-4 w-4" />}
              Export
            </Button>
            <Button onClick={openCreate} disabled={!organizationId}>
              <Plus className="h-4 w-4" />
              Add contact
            </Button>
          </div>
        }
      />

      <section className="space-y-4 p-6">
        <Card className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="filter-tags">Filter by tags</Label>
              <Input
                id="filter-tags"
                placeholder="vip, newsletter (comma separated)"
                value={filterTags}
                onChange={(event) => setFilterTags(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Match</Label>
              <Select
                value={filterMatch}
                onValueChange={(value) =>
                  setFilterMatch(value === "ALL" ? "ALL" : "ANY")
                }
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ANY">Any tag</SelectItem>
                  <SelectItem value="ALL">All tags</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {parseFilterTags(filterTags).length === 0
                  ? "Enter tags to preview"
                  : segmentLoading
                    ? "Counting…"
                    : `${segmentCount ?? 0} match`}
              </span>
              <Button
                variant="outline"
                disabled={
                  !organizationId ||
                  parseFilterTags(filterTags).length === 0 ||
                  !segmentCount
                }
                onClick={() => {
                  setNewListName("");
                  setListDialogOpen(true);
                }}
              >
                <ListPlus className="h-4 w-4" />
                Create list
              </Button>
            </div>
          </div>
        </Card>

        <DataGrid
          label="Contacts"
          data={contacts}
          columns={contactColumns}
          getRowId={(row) => row.id}
          loading={loading}
          enableSelection
          searchPlaceholder="Search by name, email, or tag…"
          bulkActions={(rows, clear) => (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => {
                setSelectedIds(new Set(rows.map((row) => row.id)));
                setClearGridSelection(() => clear);
                setBulkDeleteOpen(true);
              }}
            >
              <Trash2 className="h-4 w-4" />
              Delete selected
            </Button>
          )}
          empty={
            <EmptyState
              icon={Users}
              title="No contacts yet"
              description="Add someone, or import a CSV, to start building your audience."
              action={
                <Button
                  onClick={openCreate}
                  disabled={!organizationId}
                  variant="outline"
                >
                  <Plus className="h-4 w-4" />
                  Add contact
                </Button>
              }
            />
          }
          noResults={
            <EmptyState
              icon={Search}
              title="No matching contacts"
              description="Try a different search."
            />
          }
          renderMobileRow={(contact) => (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{contact.email}</div>
                <div className="truncate text-sm text-muted-foreground">
                  {[contact.firstName, contact.lastName]
                    .filter(Boolean)
                    .join(" ") || "No name"}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <Badge variant={statusVariant(contact.status)}>
                    {contact.status}
                  </Badge>
                  {(contact.tags ?? []).slice(0, 2).map((tag) => (
                    <Badge key={tag} variant="outline" className="font-normal">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
              <RowActions
                rowLabel={contact.email}
                actions={[
                  {
                    label: "See what this person has done",
                    icon: Activity,
                    onSelect: () => void openActivity(contact),
                  },
                  {
                    label: "Edit this contact",
                    icon: Pencil,
                    onSelect: () => openEdit(contact),
                  },
                  {
                    label: "Delete this contact",
                    icon: Trash2,
                    destructive: true,
                    onSelect: () => setDeleteTarget(contact),
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
            <DialogTitle>{editing ? "Edit contact" : "Add contact"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update this contact's details."
                : "Add a contact to your organization."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="firstName">First name</Label>
                <Input
                  id="firstName"
                  value={form.firstName}
                  onChange={(e) =>
                    setForm({ ...form, firstName: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last name</Label>
                <Input
                  id="lastName"
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tags">Tags</Label>
              <Input
                id="tags"
                placeholder="vip, newsletter (comma separated)"
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
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
                {editing ? "Save changes" : "Add contact"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete contact?"
        description={`${deleteTarget?.email} will be permanently removed.`}
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={confirmDelete}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => !open && setBulkDeleteOpen(false)}
        title={`Delete ${selectedIds.size} contact${selectedIds.size === 1 ? "" : "s"}?`}
        description="They will be permanently removed, along with their list memberships. Suppressions are kept, so suppressed addresses stay suppressed."
        confirmLabel="Delete"
        loading={bulkDeleting}
        onConfirm={confirmBulkDelete}
      />

      <Dialog
        open={importDialogOpen}
        onOpenChange={(open) => !open && closeImportDialog()}
      >
        <DialogContent
          className={importStep === "review" ? "max-w-3xl" : undefined}
        >
          <form onSubmit={runPreview}>
            <DialogHeader>
              <DialogTitle>
                {importStep === "review"
                  ? "Review this import"
                  : "Import contacts"}
              </DialogTitle>
              <DialogDescription>
                {importStep === "review"
                  ? "Nothing has been saved yet. Contacts are matched on email address — decide what happens to the ones you already have."
                  : "Contacts are matched on email address. You'll see anyone who already exists before anything is saved."}
              </DialogDescription>
            </DialogHeader>

            <div
              className={
                importStep === "review"
                  ? "max-h-[60vh] space-y-4 overflow-y-auto py-4"
                  : "space-y-4 py-4"
              }
            >
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <span className="font-medium">{importFile?.name}</span>
                {importFile ? (
                  <span className="ml-2 text-muted-foreground">
                    {Math.max(1, Math.round(importFile.size / 1024))} KB
                  </span>
                ) : null}
              </div>

              {importStep === "options" ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="importTarget">Add to a list</Label>
                    <Select
                      value={importTarget}
                      onValueChange={(value) =>
                        setImportTarget(value as "none" | "existing" | "new")
                      }
                    >
                      <SelectTrigger id="importTarget">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">
                          Don&apos;t add to a list
                        </SelectItem>
                        <SelectItem
                          value="existing"
                          disabled={lists.length === 0}
                        >
                          Existing list
                        </SelectItem>
                        <SelectItem value="new">Create a new list</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {importTarget === "existing" ? (
                    <div className="space-y-2">
                      <Label htmlFor="importListId">List</Label>
                      <Select
                        value={importListId}
                        onValueChange={setImportListId}
                      >
                        <SelectTrigger id="importListId">
                          <SelectValue placeholder="Choose a list" />
                        </SelectTrigger>
                        <SelectContent>
                          {lists.map((list) => (
                            <SelectItem key={list.id} value={list.id}>
                              {list.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}

                  {importTarget === "new" ? (
                    <div className="space-y-2">
                      <Label htmlFor="importListName">New list name</Label>
                      <Input
                        id="importListName"
                        value={importListName}
                        onChange={(event) =>
                          setImportListName(event.target.value)
                        }
                        placeholder="e.g. Newsletter signups"
                      />
                      <p className="text-xs text-muted-foreground">
                        A list with this name is reused if it already exists.
                      </p>
                    </div>
                  ) : null}
                </>
              ) : null}

              {importStep === "review" && importPreview ? (
                <ImportReview
                  preview={importPreview}
                  defaultResolution={defaultResolution}
                  onDefaultResolutionChange={setDefaultResolution}
                  overrides={overrides}
                  onOverride={setOverride}
                  resolutionFor={resolutionFor}
                  editing={editingDuplicate}
                  onEditingChange={setEditingDuplicate}
                />
              ) : null}

              {importErrors.length > 0 ? (
                <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                  <div className="text-sm font-medium text-destructive">
                    {importErrors.length} row
                    {importErrors.length === 1 ? "" : "s"} couldn&apos;t be read
                  </div>
                  <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
                    {importErrors.slice(0, 50).map((error, index) => (
                      <li key={`${error.row}-${index}`}>
                        Row {error.row}: {error.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={
                  importStep === "review"
                    ? () => setImportStep("options")
                    : closeImportDialog
                }
              >
                {importStep === "review"
                  ? "Back"
                  : importErrors.length > 0
                    ? "Close"
                    : "Cancel"}
              </Button>
              {importStep === "review" ? (
                <Button
                  type="button"
                  onClick={() => void runImport()}
                  disabled={importing || !importPreview?.totalRows}
                >
                  {importing ? <Spinner /> : null}
                  {importPreview
                    ? `Import ${importPreview.totalRows} contact${importPreview.totalRows === 1 ? "" : "s"}`
                    : "Import"}
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={
                    previewing ||
                    !importFile ||
                    (importTarget === "existing" && !importListId) ||
                    (importTarget === "new" && !importListName.trim())
                  }
                >
                  {previewing ? <Spinner /> : null}
                  Continue
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={listDialogOpen} onOpenChange={setListDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create list from filter</DialogTitle>
            <DialogDescription>
              {segmentCount ?? 0} contact{segmentCount === 1 ? "" : "s"} matching{" "}
              {filterMatch === "ALL" ? "all" : "any"} of:{" "}
              {parseFilterTags(filterTags).join(", ")}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createListFromSegment} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-list-name">List name</Label>
              <Input
                id="new-list-name"
                value={newListName}
                onChange={(event) => setNewListName(event.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setListDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creatingList}>
                {creatingList ? <Spinner /> : null}
                Create list
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={activityContact !== null}
        onOpenChange={(open) => !open && setActivityContact(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activity</DialogTitle>
            <DialogDescription>{activityContact?.email}</DialogDescription>
          </DialogHeader>
          {activityLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-8 w-full" />
              ))}
            </div>
          ) : activity.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No email activity yet.
            </p>
          ) : (
            <ul className="max-h-80 space-y-3 overflow-y-auto">
              {activity.map((event) => (
                <li key={event.id} className="flex items-start gap-3 text-sm">
                  <Badge variant="outline" className="mt-0.5 font-normal">
                    {event.type}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      {event.subject ?? "(no subject)"}
                      {event.campaignName ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · {event.campaignName}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(event.occurredAt)}
                      {event.url ? ` · ${event.url}` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
