import { FormEvent, useEffect, useState } from "react";
import {
  CalendarClock,
  Megaphone,
  Pencil,
  Plus,
  Send,
  Trash2,
  Users
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import {
  api,
  type Campaign,
  type Contact,
  type ContactList,
  type Template
} from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent } from "../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../components/ui/dialog.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../components/ui/select.js";
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

const emptyCampaignForm = {
  name: "",
  subject: "",
  templateId: "",
  contactListId: ""
};

function statusVariant(status: string) {
  if (status === "SENT") return "success" as const;
  if (status === "SENDING") return "warning" as const;
  if (status === "CANCELLED") return "destructive" as const;
  return "secondary" as const;
}

function toDatetimeLocal(value: string) {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export function Campaigns() {
  const { currentOrganizationId: organizationId } = useSession();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactLists, setContactLists] = useState<ContactList[]>([]);
  const [loading, setLoading] = useState(true);
  const [campaignDialogOpen, setCampaignDialogOpen] = useState(false);
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [editingList, setEditingList] = useState<ContactList | null>(null);
  const [deleteListTarget, setDeleteListTarget] = useState<ContactList | null>(
    null
  );
  const [scheduleTarget, setScheduleTarget] = useState<Campaign | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);
  const [campaignForm, setCampaignForm] = useState(emptyCampaignForm);
  const [listName, setListName] = useState("");
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [scheduledAt, setScheduledAt] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!organizationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [nextCampaigns, nextTemplates, nextContacts, nextLists] =
        await Promise.all([
          api.listCampaigns(organizationId),
          api.listTemplates(organizationId),
          api.listContacts(organizationId),
          api.listContactLists(organizationId)
        ]);
      setCampaigns(nextCampaigns);
      setTemplates(nextTemplates);
      setContacts(nextContacts);
      setContactLists(nextLists);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load campaigns"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [organizationId]);

  useEffect(() => {
    if (
      !organizationId ||
      !campaigns.some((campaign) =>
        ["SCHEDULED", "SENDING"].includes(campaign.status)
      )
    ) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void load();
    }, 3000);

    return () => window.clearInterval(intervalId);
  }, [campaigns, organizationId]);

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
    setSelectedContactIds([]);
    setListDialogOpen(true);
  }

  function openEditList(list: ContactList) {
    setEditingList(list);
    setListName(list.name);
    setSelectedContactIds(list.contacts?.map((contact) => contact.id) ?? []);
    setListDialogOpen(true);
  }

  function closeListDialog(open: boolean) {
    setListDialogOpen(open);
    if (!open) {
      setEditingList(null);
      setListName("");
      setSelectedContactIds([]);
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
          contactIds: selectedContactIds
        });
        toast.success("Contact list updated.");
      } else {
        await api.createContactList({
          organizationId,
          name: listName,
          contactIds: selectedContactIds
        });
        toast.success("Contact list created.");
      }
      setListDialogOpen(false);
      setEditingList(null);
      setListName("");
      setSelectedContactIds([]);
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

  async function createCampaign(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) return;

    setSaving(true);
    try {
      await api.createCampaign({
        organizationId,
        ...campaignForm
      });
      toast.success("Campaign draft created.");
      setCampaignDialogOpen(false);
      setCampaignForm(emptyCampaignForm);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save campaign"
      );
    } finally {
      setSaving(false);
    }
  }

  async function sendNow(campaign: Campaign) {
    setSaving(true);
    try {
      await api.sendCampaignNow(campaign.id);
      toast.success("Campaign queued.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to send.");
    } finally {
      setSaving(false);
    }
  }

  async function schedule(event: FormEvent) {
    event.preventDefault();
    if (!scheduleTarget) return;

    setSaving(true);
    try {
      await api.scheduleCampaign(
        scheduleTarget.id,
        new Date(scheduledAt).toISOString()
      );
      toast.success("Campaign scheduled.");
      setScheduleTarget(null);
      setScheduledAt("");
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to schedule campaign"
      );
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await api.deleteCampaign(deleteTarget.id);
      toast.success("Campaign deleted.");
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Draft, schedule, and send list-based campaigns."
        actions={
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={openCreateList}
              disabled={!organizationId}
            >
              <Users className="h-4 w-4" />
              New list
            </Button>
            <Button
              type="button"
              onClick={() => setCampaignDialogOpen(true)}
              disabled={!organizationId || templates.length === 0 || contactLists.length === 0}
            >
              <Plus className="h-4 w-4" />
              New campaign
            </Button>
          </div>
        }
      />

      <section className="grid gap-4 p-6 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Contact lists</h2>
                <p className="text-sm text-muted-foreground">
                  Audiences for campaigns.
                </p>
              </div>
              <Users className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="mt-4 space-y-2">
              {loading ? (
                <Skeleton className="h-16 w-full" />
              ) : contactLists.length === 0 ? (
                <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  No contact lists yet.
                </p>
              ) : (
                contactLists.map((list) => (
                  <div key={list.id} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{list.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {list._count?.contacts ?? list.contacts?.length ?? 0} contacts
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEditList(list)}
                          aria-label="Edit contact list"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteListTarget(list)}
                          aria-label="Delete contact list"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          {loading ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : campaigns.length === 0 ? (
            <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Megaphone className="h-6 w-6" />
              </div>
              <div>
                <div className="font-medium">No campaigns yet</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create a contact list and template, then draft your first campaign.
                </p>
              </div>
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Audience</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Queued</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((campaign) => (
                  <TableRow key={campaign.id}>
                    <TableCell>
                      <div className="font-medium">{campaign.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {campaign.subject}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {campaign.contactList?.name ?? "No list"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(campaign.status)}>
                        {campaign.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{campaign._count?.emailJobs ?? 0}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={saving || !["DRAFT", "SCHEDULED"].includes(campaign.status)}
                          onClick={() => sendNow(campaign)}
                          aria-label="Send campaign now"
                        >
                          <Send className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={saving || !["DRAFT", "SCHEDULED"].includes(campaign.status)}
                          onClick={() => {
                            setScheduleTarget(campaign);
                            setScheduledAt(
                              campaign.scheduledAt
                                ? toDatetimeLocal(campaign.scheduledAt)
                                : ""
                            );
                          }}
                          aria-label="Schedule campaign"
                        >
                          <CalendarClock className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive"
                          disabled={saving || !["DRAFT", "CANCELLED"].includes(campaign.status)}
                          onClick={() => setDeleteTarget(campaign)}
                          aria-label="Delete campaign"
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

      <Dialog open={listDialogOpen} onOpenChange={closeListDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingList ? "Edit contact list" : "New contact list"}
            </DialogTitle>
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
            <div className="max-h-64 space-y-2 overflow-auto rounded-md border p-3">
              {contacts.map((contact) => (
                <label key={contact.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedContactIds.includes(contact.id)}
                    onChange={() => toggleContact(contact.id)}
                  />
                  <span>{contact.email}</span>
                </label>
              ))}
            </div>
            <DialogFooter>
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

      <Dialog open={campaignDialogOpen} onOpenChange={setCampaignDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New campaign</DialogTitle>
          </DialogHeader>
          <form onSubmit={createCampaign} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="campaignName">Name</Label>
                <Input
                  id="campaignName"
                  value={campaignForm.name}
                  onChange={(event) =>
                    setCampaignForm({ ...campaignForm, name: event.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="subject">Subject</Label>
                <Input
                  id="subject"
                  value={campaignForm.subject}
                  onChange={(event) =>
                    setCampaignForm({
                      ...campaignForm,
                      subject: event.target.value
                    })
                  }
                  required
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Template</Label>
                <Select
                  value={campaignForm.templateId}
                  onValueChange={(value) =>
                    setCampaignForm({ ...campaignForm, templateId: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Contact list</Label>
                <Select
                  value={campaignForm.contactListId}
                  onValueChange={(value) =>
                    setCampaignForm({ ...campaignForm, contactListId: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select list" />
                  </SelectTrigger>
                  <SelectContent>
                    {contactLists.map((list) => (
                      <SelectItem key={list.id} value={list.id}>
                        {list.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={
                  saving ||
                  !campaignForm.templateId ||
                  !campaignForm.contactListId
                }
              >
                {saving ? <Spinner /> : null}
                Create draft
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={scheduleTarget !== null}
        onOpenChange={(open) => !open && setScheduleTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule campaign</DialogTitle>
          </DialogHeader>
          <form onSubmit={schedule} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="scheduledAt">Send at</Label>
              <Input
                id="scheduledAt"
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={saving}>
                {saving ? <Spinner /> : null}
                Schedule
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete campaign?"
        description={`"${deleteTarget?.name}" will be permanently removed.`}
        confirmLabel="Delete"
        loading={saving}
        onConfirm={confirmDelete}
      />

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
