import { FormEvent, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { api, type Contact } from "../lib/api.js";
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

interface ContactForm {
  email: string;
  firstName: string;
  lastName: string;
}

const emptyForm: ContactForm = { email: "", firstName: "", lastName: "" };

const PAGE_SIZE = 10;

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

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return contacts;
    }
    return contacts.filter((contact) =>
      [contact.email, contact.firstName, contact.lastName]
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
      lastName: contact.lastName ?? ""
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
      lastName: form.lastName || undefined
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

  return (
    <>
      <PageHeader
        title="Contacts"
        description="Store contacts and list memberships."
        actions={
          <Button onClick={openCreate} disabled={!organizationId}>
            <Plus className="h-4 w-4" />
            Add contact
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
                      <TableHead>Email</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginated.map((contact) => (
                      <TableRow key={contact.id}>
                        <TableCell className="font-medium">{contact.email}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {[contact.firstName, contact.lastName]
                            .filter(Boolean)
                            .join(" ") || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(contact.status)}>
                            {contact.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
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
    </>
  );
}
