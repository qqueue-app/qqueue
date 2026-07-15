import { FormEvent, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { api, type Contact, type ContactList } from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Checkbox } from "../components/ui/checkbox.js";
import { Card } from "../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../components/ui/dialog.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { Spinner } from "../components/ui/spinner.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../components/ui/table.js";

const MEMBER_PREVIEW = 3;

export function ContactLists() {
  const { currentOrganizationId: organizationId } = useSession();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactLists, setContactLists] = useState<ContactList[]>([]);
  const [loading, setLoading] = useState(true);
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [editingList, setEditingList] = useState<ContactList | null>(null);
  const [deleteListTarget, setDeleteListTarget] = useState<ContactList | null>(
    null
  );
  const [listName, setListName] = useState("");
  const [listDescription, setListDescription] = useState("");
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [contactSearch, setContactSearch] = useState("");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return contactLists;
    }
    return contactLists.filter((list) =>
      list.name.toLowerCase().includes(query)
    );
  }, [contactLists, search]);

  const filteredContacts = useMemo(() => {
    const query = contactSearch.trim().toLowerCase();
    if (!query) {
      return contacts;
    }
    return contacts.filter((contact) =>
      [contact.email, contact.firstName, contact.lastName]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(query))
    );
  }, [contacts, contactSearch]);

  const allFilteredSelected =
    filteredContacts.length > 0 &&
    filteredContacts.every((contact) => selectedContactIds.includes(contact.id));

  function toggleSelectAll() {
    const filteredIds = filteredContacts.map((contact) => contact.id);
    setSelectedContactIds((current) => {
      if (allFilteredSelected) {
        return current.filter((id) => !filteredIds.includes(id));
      }
      return Array.from(new Set([...current, ...filteredIds]));
    });
  }

  async function load() {
    if (!organizationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [nextContacts, nextLists] = await Promise.all([
        api.listContacts(organizationId),
        api.listContactLists(organizationId)
      ]);
      setContacts(nextContacts);
      setContactLists(nextLists);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load contact lists"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [organizationId]);

  function toggleContact(contactId: string) {
    setSelectedContactIds((current) =>
      current.includes(contactId)
        ? current.filter((id) => id !== contactId)
        : [...current, contactId]
    );
  }

  function openCreateList() {
    setEditingList(null);
    setListName("");
    setListDescription("");
    setSelectedContactIds([]);
    setContactSearch("");
    setListDialogOpen(true);
  }

  function openEditList(list: ContactList) {
    setEditingList(list);
    setListName(list.name);
    setListDescription(list.description ?? "");
    setSelectedContactIds(list.contacts?.map((contact) => contact.id) ?? []);
    setContactSearch("");
    setListDialogOpen(true);
  }

  function closeListDialog(open: boolean) {
    setListDialogOpen(open);
    if (!open) {
      setEditingList(null);
      setListName("");
      setListDescription("");
      setSelectedContactIds([]);
      setContactSearch("");
    }
  }

  async function saveList(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) return;

    setSaving(true);
    try {
      if (editingList) {
        await api.updateContactList(editingList.id, {
          name: listName,
          description: listDescription || undefined,
          contactIds: selectedContactIds
        });
        toast.success("Contact list updated.");
      } else {
        await api.createContactList({
          organizationId,
          name: listName,
          description: listDescription || undefined,
          contactIds: selectedContactIds
        });
        toast.success("Contact list created.");
      }
      setListDialogOpen(false);
      setEditingList(null);
      setListName("");
      setListDescription("");
      setSelectedContactIds([]);
      setContactSearch("");
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save contact list"
      );
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteList() {
    if (!deleteListTarget) return;
    setSaving(true);
    try {
      await api.deleteContactList(deleteListTarget.id);
      toast.success("Contact list deleted.");
      setDeleteListTarget(null);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to delete contact list"
      );
    } finally {
      setSaving(false);
    }
  }

  function memberCount(list: ContactList) {
    return list._count?.contacts ?? list.contacts?.length ?? 0;
  }

  return (
    <>
      <PageHeader
        title="Lists"
        description="Group contacts into audiences for your campaigns."
        actions={
          <Button type="button" onClick={openCreateList} disabled={!organizationId}>
            <Plus className="h-4 w-4" />
            New list
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
          ) : contactLists.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No contact lists yet"
              description="Create your first list to start grouping contacts into audiences."
              action={
                <Button
                  type="button"
                  variant="outline"
                  onClick={openCreateList}
                  disabled={!organizationId}
                >
                  <Plus className="h-4 w-4" />
                  New list
                </Button>
              }
            />
          ) : (
            <>
              <div className="flex items-center gap-3 border-b p-3">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search lists…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="pl-9"
                  />
                </div>
                <span className="shrink-0 text-sm text-muted-foreground">
                  {filtered.length} of {contactLists.length}
                </span>
              </div>

              {filtered.length === 0 ? (
                <EmptyState
                  icon={Search}
                  title="No matches"
                  description={`No lists match "${search}".`}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Members</TableHead>
                      <TableHead>Used in</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((list) => {
                      const members = list.contacts ?? [];
                      const preview = members.slice(0, MEMBER_PREVIEW);
                      const remaining = memberCount(list) - preview.length;
                      const campaignCount = list._count?.campaigns ?? 0;

                      return (
                        <TableRow key={list.id}>
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <Users className="h-4 w-4" />
                              </div>
                              <div className="min-w-0">
                                <span className="font-medium">{list.name}</span>
                                {list.description ? (
                                  <p className="truncate text-xs text-muted-foreground">
                                    {list.description}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <span className="text-sm font-medium">
                                {memberCount(list)}{" "}
                                {memberCount(list) === 1 ? "contact" : "contacts"}
                              </span>
                              {preview.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {preview.map((contact) => (
                                    <Badge
                                      key={contact.id}
                                      variant="secondary"
                                      className="font-normal"
                                    >
                                      {contact.email}
                                    </Badge>
                                  ))}
                                  {remaining > 0 ? (
                                    <Badge variant="outline" className="font-normal">
                                      +{remaining} more
                                    </Badge>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="text-sm text-muted-foreground">
                                  Empty list
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {campaignCount}{" "}
                            {campaignCount === 1 ? "campaign" : "campaigns"}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => openEditList(list)}
                                aria-label="Edit contact list"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="text-muted-foreground hover:text-destructive"
                                onClick={() => setDeleteListTarget(list)}
                                aria-label="Delete contact list"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </Card>
      </section>

      <Dialog open={listDialogOpen} onOpenChange={closeListDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingList ? "Edit contact list" : "New contact list"}
            </DialogTitle>
            <DialogDescription>
              {editingList
                ? "Rename the list or change which contacts belong to it."
                : "Name the list and choose the contacts to include."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveList} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="listName">Name</Label>
              <Input
                id="listName"
                value={listName}
                onChange={(event) => setListName(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="listDescription">Description</Label>
              <Input
                id="listDescription"
                placeholder="What is this list for? (optional)"
                value={listDescription}
                onChange={(event) => setListDescription(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Contacts</Label>
                <span className="text-xs text-muted-foreground">
                  {selectedContactIds.length} selected
                </span>
              </div>
              {contacts.length === 0 ? (
                <div className="rounded-md border p-2">
                  <p className="px-1 py-2 text-sm text-muted-foreground">
                    No contacts available yet.
                  </p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <div className="border-b p-2">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search contacts by name or email…"
                        value={contactSearch}
                        onChange={(event) => setContactSearch(event.target.value)}
                        className="h-9 pl-8"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-b px-2 py-1.5">
                    <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
                      <Checkbox
                        checked={allFilteredSelected}
                        onCheckedChange={toggleSelectAll}
                        disabled={filteredContacts.length === 0}
                        aria-label={
                          allFilteredSelected
                            ? "Clear all contacts"
                            : "Select all contacts"
                        }
                      />
                      {allFilteredSelected ? "Clear all" : "Select all"}
                      {contactSearch.trim() ? " matching" : ""}
                    </label>
                    <span className="text-xs text-muted-foreground">
                      {filteredContacts.length} of {contacts.length}
                    </span>
                  </div>
                  <div className="max-h-56 space-y-1 overflow-auto p-2">
                    {filteredContacts.length === 0 ? (
                      <p className="px-1 py-2 text-sm text-muted-foreground">
                        No contacts match “{contactSearch}”.
                      </p>
                    ) : (
                      filteredContacts.map((contact) => {
                        const name = [contact.firstName, contact.lastName]
                          .filter(Boolean)
                          .join(" ");
                        return (
                          <label
                            key={contact.id}
                            className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/60"
                          >
                            <Checkbox
                              checked={selectedContactIds.includes(contact.id)}
                              onCheckedChange={() => toggleContact(contact.id)}
                              aria-label={`Select ${contact.email}`}
                            />
                            <span className="min-w-0 truncate">
                              {name ? (
                                <>
                                  {name}{" "}
                                  <span className="text-muted-foreground">
                                    {contact.email}
                                  </span>
                                </>
                              ) : (
                                contact.email
                              )}
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => closeListDialog(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  saving || (!editingList && selectedContactIds.length === 0)
                }
              >
                {saving ? <Spinner /> : null}
                {editingList ? "Save changes" : "Create list"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteListTarget !== null}
        onOpenChange={(open) => !open && setDeleteListTarget(null)}
        title="Delete contact list?"
        description={`"${deleteListTarget?.name}" will be removed from future campaign drafts.`}
        confirmLabel="Delete"
        loading={saving}
        onConfirm={confirmDeleteList}
      />
    </>
  );
}
