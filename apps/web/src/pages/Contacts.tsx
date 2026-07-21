import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
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
import {
  api,
  type Contact,
  type ContactActivityEvent,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../components/ui/table.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../components/ui/select.js";

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

const PAGE_SIZE = 10;

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
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

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

  // Bulk selection for delete.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

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

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return contacts;
    }
    return contacts.filter((contact) =>
      [contact.email, contact.firstName, contact.lastName, ...(contact.tags ?? [])]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(query))
    );
  }, [contacts, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const paginated = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  // Reset to the first page whenever the search query changes.
  useEffect(() => {
    setPage(1);
  }, [search]);

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

  async function runImport(event: FormEvent) {
    event.preventDefault();
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
        contactListId:
          importTarget === "existing" ? importListId || undefined : undefined,
        contactListName:
          importTarget === "new" ? importListName.trim() || undefined : undefined
      });

      const parts = [`${summary.created} added`, `${summary.updated} updated`];
      if (summary.suppressed > 0) parts.push(`${summary.suppressed} suppressed`);
      if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);
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

  function closeImportDialog() {
    setImportDialogOpen(false);
    setImportFile(null);
    setImportErrors([]);
    setImportListName("");
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

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAllFiltered() {
    setSelectedIds((current) => {
      const allSelected = filtered.every((contact) => current.has(contact.id));
      if (allSelected) {
        return new Set();
      }
      return new Set(filtered.map((contact) => contact.id));
    });
  }

  async function confirmBulkDelete() {
    if (!organizationId || selectedIds.size === 0) return;
    setBulkDeleting(true);
    try {
      const { deleted } = await api.bulkDeleteContacts(
        organizationId,
        Array.from(selectedIds)
      );
      toast.success(`${deleted} contact${deleted === 1 ? "" : "s"} removed.`);
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

        <Card className="overflow-hidden">
          {loading ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : contacts.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No contacts yet"
              description="Add a contact to start building your audience."
              action={
                <Button onClick={openCreate} disabled={!organizationId} variant="outline">
                  <Plus className="h-4 w-4" />
                  Add contact
                </Button>
              }
            />
          ) : (
            <>
              <div className="flex items-center gap-3 border-b p-3">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or email…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="pl-9"
                  />
                </div>
                <span className="shrink-0 text-sm text-muted-foreground">
                  {filtered.length} of {contacts.length}
                </span>
              </div>

              {selectedIds.size > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
                  <span className="text-sm font-medium">
                    {selectedIds.size} selected
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    Clear selection
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => setBulkDeleteOpen(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete selected
                  </Button>
                </div>
              ) : null}

              {filtered.length === 0 ? (
                <EmptyState
                  icon={Search}
                  title="No matches"
                  description={`No contacts match "${search}".`}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        {/*
                          Selects everything matching the current search, not
                          just the visible page — otherwise "select all" on a
                          filtered set of 400 would silently mean 10.
                        */}
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer accent-primary"
                          aria-label="Select all matching contacts"
                          checked={
                            filtered.length > 0 &&
                            filtered.every((contact) =>
                              selectedIds.has(contact.id)
                            )
                          }
                          onChange={toggleSelectAllFiltered}
                        />
                      </TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Tags</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginated.map((contact) => (
                      <TableRow key={contact.id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer accent-primary"
                            aria-label={`Select ${contact.email}`}
                            checked={selectedIds.has(contact.id)}
                            onChange={() => toggleSelected(contact.id)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{contact.email}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {[contact.firstName, contact.lastName]
                            .filter(Boolean)
                            .join(" ") || "—"}
                        </TableCell>
                        <TableCell>
                          {contact.tags && contact.tags.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {contact.tags.map((tag) => (
                                <Badge
                                  key={tag}
                                  variant="outline"
                                  className="font-normal"
                                >
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(contact.status)}>
                            {contact.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(contact.createdAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => openActivity(contact)}
                              aria-label="View activity"
                            >
                              <Activity className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => openEdit(contact)}
                              aria-label="Edit contact"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => setDeleteTarget(contact)}
                              aria-label="Delete contact"
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

              {pageCount > 1 ? (
                <div className="flex items-center justify-between border-t p-3 text-sm">
                  <span className="text-muted-foreground">
                    Page {currentPage} of {pageCount}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setPage((value) => Math.max(1, value - 1))}
                      disabled={currentPage === 1}
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() =>
                        setPage((value) => Math.min(pageCount, value + 1))
                      }
                      disabled={currentPage === pageCount}
                      aria-label="Next page"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </Card>
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
        <DialogContent>
          <form onSubmit={runImport}>
            <DialogHeader>
              <DialogTitle>Import contacts</DialogTitle>
              <DialogDescription>
                Contacts are matched on email address — importing someone who
                already exists updates them and merges tags instead of creating
                a duplicate.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <span className="font-medium">{importFile?.name}</span>
                {importFile ? (
                  <span className="ml-2 text-muted-foreground">
                    {Math.max(1, Math.round(importFile.size / 1024))} KB
                  </span>
                ) : null}
              </div>

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
                    <SelectItem value="existing" disabled={lists.length === 0}>
                      Existing list
                    </SelectItem>
                    <SelectItem value="new">Create a new list</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {importTarget === "existing" ? (
                <div className="space-y-2">
                  <Label htmlFor="importListId">List</Label>
                  <Select value={importListId} onValueChange={setImportListId}>
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
                    onChange={(event) => setImportListName(event.target.value)}
                    placeholder="e.g. Newsletter signups"
                  />
                  <p className="text-xs text-muted-foreground">
                    A list with this name is reused if it already exists.
                  </p>
                </div>
              ) : null}

              {importErrors.length > 0 ? (
                <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                  <div className="text-sm font-medium text-destructive">
                    {importErrors.length} row
                    {importErrors.length === 1 ? "" : "s"} skipped
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
                onClick={closeImportDialog}
              >
                {importErrors.length > 0 ? "Close" : "Cancel"}
              </Button>
              <Button
                type="submit"
                disabled={
                  importing ||
                  !importFile ||
                  (importTarget === "existing" && !importListId) ||
                  (importTarget === "new" && !importListName.trim())
                }
              >
                {importing ? <Spinner /> : null}
                Import
              </Button>
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
