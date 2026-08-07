import { useMemo, useState, type FormEvent } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { PageHeader } from "../components/PageHeader.js";
import { ListsTabs } from "../components/ListsTabs.js";
import { EmptyState } from "../components/EmptyState.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { api, type ContactList } from "../lib/api.js";
import { formatCount } from "../lib/format.js";
import { qk } from "../lib/query-client.js";
import { useApiMutation, useOrgQuery } from "../lib/use-api.js";
import { useSession } from "../lib/session-context.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Checkbox } from "../components/ui/checkbox.js";
import { DataGrid } from "../components/ui/data-grid.js";
import { RowActions } from "../components/ui/row-actions.js";
import { Hint } from "../components/ui/tooltip.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Spinner } from "../components/ui/spinner.js";

const MEMBER_PREVIEW = 3;

function memberCount(list: ContactList) {
  return list._count?.contacts ?? list.contacts?.length ?? 0;
}

export function ContactLists() {
  const { currentOrganizationId: organizationId } = useSession();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ContactList | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContactList | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [contactSearch, setContactSearch] = useState("");

  const listsQuery = useOrgQuery(
    organizationId,
    qk.contactLists(organizationId ?? ""),
    (id) => api.listContactLists(id)
  );
  // Only needed while the dialog is open, but contacts are cached org-wide and
  // the Contacts page will have warmed this already in most sessions.
  const contactsQuery = useOrgQuery(
    organizationId,
    qk.contacts(organizationId ?? ""),
    (id) => api.listContacts(id)
  );

  const contacts = useMemo(
    () => contactsQuery.data ?? [],
    [contactsQuery.data]
  );

  const filteredContacts = useMemo(() => {
    const query = contactSearch.trim().toLowerCase();
    if (!query) return contacts;
    return contacts.filter((contact) =>
      [contact.email, contact.firstName, contact.lastName]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(query))
    );
  }, [contacts, contactSearch]);

  const allFilteredSelected =
    filteredContacts.length > 0 &&
    filteredContacts.every((contact) =>
      selectedContactIds.includes(contact.id)
    );

  const save = useApiMutation(
    () =>
      editing
        ? api.updateContactList(editing.id, {
            name,
            description: description || undefined,
            contactIds: selectedContactIds,
          })
        : api.createContactList({
            organizationId,
            name,
            description: description || undefined,
            contactIds: selectedContactIds,
          }),
    {
      successMessage: () =>
        editing ? "List updated." : "List created.",
      errorMessage: "Couldn't save that list.",
      invalidates: [qk.contactLists(organizationId ?? "")],
      onSuccess: () => closeDialog(),
    }
  );

  const remove = useApiMutation(
    (list: ContactList) => api.deleteContactList(list.id),
    {
      successMessage: "List deleted.",
      errorMessage: "Couldn't delete that list.",
      invalidates: [qk.contactLists(organizationId ?? "")],
      onSuccess: () => setDeleteTarget(null),
    }
  );

  function closeDialog() {
    setDialogOpen(false);
    setEditing(null);
    setName("");
    setDescription("");
    setSelectedContactIds([]);
    setContactSearch("");
  }

  function openCreate() {
    setEditing(null);
    setName("");
    setDescription("");
    setSelectedContactIds([]);
    setContactSearch("");
    setDialogOpen(true);
  }

  function openEdit(list: ContactList) {
    setEditing(list);
    setName(list.name);
    setDescription(list.description ?? "");
    setSelectedContactIds(list.contacts?.map((contact) => contact.id) ?? []);
    setContactSearch("");
    setDialogOpen(true);
  }

  function toggleSelectAll() {
    const filteredIds = filteredContacts.map((contact) => contact.id);
    setSelectedContactIds((current) =>
      allFilteredSelected
        ? current.filter((id) => !filteredIds.includes(id))
        : Array.from(new Set([...current, ...filteredIds]))
    );
  }

  const columns = useMemo<ColumnDef<ContactList, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "List",
        meta: { title: "List" },
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Users className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate font-medium">{row.original.name}</div>
              {row.original.description ? (
                <p className="truncate text-xs text-muted-foreground">
                  {row.original.description}
                </p>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        id: "members",
        accessorFn: memberCount,
        header: "People",
        meta: { title: "People" },
        cell: ({ row }) => {
          const count = memberCount(row.original);
          const preview = (row.original.contacts ?? []).slice(
            0,
            MEMBER_PREVIEW
          );
          const remaining = count - preview.length;
          return (
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">
                {formatCount(count)} {count === 1 ? "person" : "people"}
              </span>
              {preview.length > 0 ? (
                <div className="hidden flex-wrap gap-1 lg:flex">
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
                <span className="text-xs text-muted-foreground">
                  Nobody in it yet
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: "campaigns",
        accessorFn: (row) => row._count?.campaigns ?? 0,
        header: "Used by",
        meta: { title: "Used by", hideBelowMd: true },
        cell: ({ getValue }) => {
          const count = Number(getValue());
          return (
            <Hint
              label={
                count === 0
                  ? "No campaign sends to this list yet"
                  : `${count} campaign${count === 1 ? "" : "s"} send to this list`
              }
            >
              <span className="cursor-help text-muted-foreground">
                {count} {count === 1 ? "campaign" : "campaigns"}
              </span>
            </Hint>
          );
        },
      },
      {
        id: "actions",
        header: "",
        meta: { pinned: true, align: "right" },
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions
            rowLabel={row.original.name}
            actions={[
              {
                label: "Edit this list",
                icon: Pencil,
                primary: true,
                onSelect: () => openEdit(row.original),
              },
              {
                label: "Delete this list",
                icon: Trash2,
                destructive: true,
                onSelect: () => setDeleteTarget(row.original),
              },
            ]}
          />
        ),
      },
    ],
    []
  );

  return (
    <>
      <PageHeader
        title="Lists"
        description="Groups of contacts you put together by hand. Use one as the audience for a campaign."
        actions={
          <Button type="button" onClick={openCreate} disabled={!organizationId}>
            <Plus className="h-4 w-4" />
            New list
          </Button>
        }
      />

      <ListsTabs />

      <section className="p-4 sm:p-6">
        <DataGrid
          label="Contact lists"
          data={listsQuery.data ?? []}
          columns={columns}
          getRowId={(row) => row.id}
          loading={listsQuery.isPending}
          onRowClick={openEdit}
          searchPlaceholder="Search lists…"
          empty={
            <EmptyState
              icon={Users}
              title="No lists yet"
              description="Make a list to group people you email together — a newsletter audience, your customers, a launch invite list."
              action={
                <Button
                  type="button"
                  variant="outline"
                  onClick={openCreate}
                  disabled={!organizationId}
                >
                  <Plus className="h-4 w-4" />
                  New list
                </Button>
              }
            />
          }
          noResults={
            <EmptyState
              icon={Search}
              title="No matching lists"
              description="Try a different search."
            />
          }
          renderMobileRow={(list) => (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{list.name}</div>
                {list.description ? (
                  <p className="truncate text-sm text-muted-foreground">
                    {list.description}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatCount(memberCount(list))}{" "}
                  {memberCount(list) === 1 ? "person" : "people"}
                </p>
              </div>
              <RowActions
                rowLabel={list.name}
                actions={[
                  {
                    label: "Delete this list",
                    icon: Trash2,
                    primary: true,
                    destructive: true,
                    onSelect: () => setDeleteTarget(list),
                  },
                ]}
              />
            </div>
          )}
        />
      </section>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit list" : "New list"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Rename the list or change who's in it."
                : "Name the list and pick who belongs in it."}
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              save.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="listName">Name</Label>
              <Input
                id="listName"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Newsletter subscribers"
                autoFocus
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="listDescription">What it's for</Label>
              <Input
                id="listDescription"
                placeholder="Optional — a note for your teammates"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>People</Label>
                <span className="text-xs text-muted-foreground">
                  {selectedContactIds.length} selected
                </span>
              </div>

              {contacts.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                  You don't have any contacts yet. Add some first, then come
                  back and build a list.
                </p>
              ) : (
                <div className="rounded-lg border">
                  <div className="border-b p-2">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search by name or email…"
                        aria-label="Search contacts"
                        value={contactSearch}
                        onChange={(event) =>
                          setContactSearch(event.target.value)
                        }
                        className="h-9 pl-8"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-b px-2 py-1.5">
                    <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
                      <Checkbox
                        checked={
                          allFilteredSelected
                            ? true
                            : filteredContacts.some((contact) =>
                                  selectedContactIds.includes(contact.id)
                                )
                              ? "indeterminate"
                              : false
                        }
                        onCheckedChange={toggleSelectAll}
                        disabled={filteredContacts.length === 0}
                        aria-label={
                          allFilteredSelected ? "Clear all" : "Select all"
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
                        Nobody matches “{contactSearch}”.
                      </p>
                    ) : (
                      filteredContacts.map((contact) => {
                        const fullName = [contact.firstName, contact.lastName]
                          .filter(Boolean)
                          .join(" ");
                        return (
                          <label
                            key={contact.id}
                            className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/60"
                          >
                            <Checkbox
                              checked={selectedContactIds.includes(contact.id)}
                              onCheckedChange={() =>
                                setSelectedContactIds((current) =>
                                  current.includes(contact.id)
                                    ? current.filter((id) => id !== contact.id)
                                    : [...current, contact.id]
                                )
                              }
                              aria-label={`Include ${contact.email}`}
                            />
                            <span className="min-w-0 truncate">
                              {fullName ? (
                                <>
                                  {fullName}{" "}
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
              <Button type="button" variant="outline" onClick={closeDialog}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  save.isPending ||
                  (!editing && selectedContactIds.length === 0)
                }
              >
                {save.isPending ? <Spinner /> : null}
                {editing ? "Save changes" : "Create list"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this list?"
        description={`"${deleteTarget?.name}" will be removed. The people in it stay in your contacts.`}
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
      />
    </>
  );
}
