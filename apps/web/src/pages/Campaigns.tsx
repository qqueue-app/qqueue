import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart3,
  CalendarClock,
  Copy,
  Megaphone,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Send,
  Trash2
} from "lucide-react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { formatCount } from "../lib/format.js";
import { PageHeader } from "../components/PageHeader.js";
import { CampaignsTabs } from "../components/CampaignsTabs.js";
import { EmptyState } from "../components/EmptyState.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import {
  buildCron,
  BROWSER_TIMEZONE,
  describeCron,
  emptyRecurrence,
  parseCron,
  ScheduleControls
} from "../components/ScheduleControls.js";
import {
  api,
  type Campaign,
  type ContactList,
  type Template
} from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../components/ui/select.js";
import { Spinner } from "../components/ui/spinner.js";
import { DataGrid } from "../components/ui/data-grid.js";
import { RowActions, type RowAction } from "../components/ui/row-actions.js";
import { Hint } from "../components/ui/tooltip.js";

const emptyCampaignForm = {
  name: "",
  templateId: "",
  contactListId: ""
};

/** What each status means, for the badge tooltip. */
function statusHint(status: string) {
  switch (status) {
    case "DRAFT":
      return "Not sent to anyone yet. Edit it freely.";
    case "SCHEDULED":
      return "Waiting for its send time.";
    case "SENDING":
      return "Going out right now.";
    case "PAUSED":
      return "Stopped part-way. Resume it to carry on.";
    case "SENT":
      return "Finished — every email has been handed to the mail server.";
    case "CANCELLED":
      return "Stopped for good. It won't send.";
    default:
      return status;
  }
}

function statusVariant(status: string) {
  if (status === "SENT") return "success" as const;
  if (status === "SENDING") return "warning" as const;
  if (status === "CANCELLED") return "destructive" as const;
  return "secondary" as const;
}

const STATUS_FILTERS = [
  { value: "ALL", label: "All", match: () => true },
  {
    value: "PENDING",
    label: "Pending",
    match: (status: string) => status === "DRAFT" || status === "SCHEDULED"
  },
  {
    value: "SENDING",
    label: "Sending",
    match: (status: string) => status === "SENDING"
  },
  {
    value: "PAUSED",
    label: "Paused",
    match: (status: string) => status === "PAUSED"
  },
  { value: "SENT", label: "Sent", match: (status: string) => status === "SENT" },
  {
    value: "CANCELLED",
    label: "Cancelled",
    match: (status: string) => status === "CANCELLED"
  }
] as const;

function toDatetimeLocal(value: string) {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export function Campaigns() {
  const navigate = useNavigate();
  const { currentOrganizationId: organizationId } = useSession();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [contactLists, setContactLists] = useState<ContactList[]>([]);
  const [loading, setLoading] = useState(true);
  const [campaignDialogOpen, setCampaignDialogOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<Campaign | null>(null);
  const [duplicateTarget, setDuplicateTarget] = useState<Campaign | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);
  const [campaignForm, setCampaignForm] = useState(emptyCampaignForm);
  const [scheduledAt, setScheduledAt] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [recurrence, setRecurrence] = useState(emptyRecurrence);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const activeFilter =
    STATUS_FILTERS.find((filter) => filter.value === statusFilter) ??
    STATUS_FILTERS[0];
  const filteredCampaigns = campaigns.filter((campaign) =>
    activeFilter.match(campaign.status)
  );

  /**
   * What you can do to a campaign depends on where it is in its life: a draft
   * can be edited and sent, a sending one can only be paused, and a sent one is
   * history. Rather than render seven icon buttons and grey most of them out,
   * the row shows the two that matter and folds the rest into a menu.
   */
  function campaignActions(campaign: Campaign): RowAction[] {
    const isPausable = ["SCHEDULED", "SENDING", "PAUSED"].includes(
      campaign.status
    );
    return [
      {
        label: "See how this campaign performed",
        icon: BarChart3,
        primary: true,
        onSelect: () => navigate(`/campaigns/${campaign.id}/analytics`),
      },
      {
        label: "Send this campaign now",
        icon: Send,
        primary: ["DRAFT", "SCHEDULED"].includes(campaign.status),
        disabled: saving || !["DRAFT", "SCHEDULED"].includes(campaign.status),
        hidden: ["SENT", "CANCELLED"].includes(campaign.status),
        onSelect: () => sendNow(campaign),
      },
      {
        label:
          campaign.status === "PAUSED"
            ? "Resume this campaign"
            : "Pause this campaign",
        icon: campaign.status === "PAUSED" ? Play : Pause,
        disabled: saving,
        hidden: !isPausable,
        onSelect: () => togglePause(campaign),
      },
      {
        label: "Schedule this campaign",
        icon: CalendarClock,
        disabled:
          saving || !["DRAFT", "SCHEDULED", "PAUSED"].includes(campaign.status),
        onSelect: () => openSchedule(campaign),
      },
      {
        label: "Edit this campaign",
        icon: Pencil,
        disabled: saving || campaign.status !== "DRAFT",
        onSelect: () => openEditCampaign(campaign),
      },
      {
        label: "Make a copy",
        icon: Copy,
        disabled: saving,
        onSelect: () => setDuplicateTarget(campaign),
      },
      {
        label: "Delete this campaign",
        icon: Trash2,
        destructive: true,
        disabled: saving || !["DRAFT", "CANCELLED"].includes(campaign.status),
        onSelect: () => setDeleteTarget(campaign),
      },
    ];
  }

  const campaignColumns = useMemo<ColumnDef<Campaign, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Campaign",
        meta: { title: "Campaign" },
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{row.original.name}</div>
            <div className="truncate text-sm text-muted-foreground">
              {row.original.template?.subject ?? "No template"}
            </div>
            {row.original.cronExpression ? (
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Repeat className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  {describeCron(row.original.cronExpression) ??
                    row.original.cronExpression}
                  {row.original.nextRunAt && row.original.status !== "PAUSED"
                    ? ` · next ${new Date(row.original.nextRunAt).toLocaleString()}`
                    : ""}
                </span>
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: "audience",
        accessorFn: (row) => row.contactList?.name ?? "",
        header: "Audience",
        meta: { title: "Audience", hideBelowMd: true },
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.contactList?.name ?? "No list"}
          </span>
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
        id: "queued",
        accessorFn: (row) => row._count?.emailJobs ?? 0,
        header: "Emails",
        meta: { title: "Emails", align: "right", hideBelowLg: true },
        cell: ({ getValue }) => (
          <Hint label="How many individual emails this campaign has created">
            <span className="cursor-help tabular-nums">
              {formatCount(Number(getValue()))}
            </span>
          </Hint>
        ),
      },
      {
        id: "actions",
        header: "",
        meta: { pinned: true, align: "right" },
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions
            rowLabel={row.original.name}
            actions={campaignActions(row.original)}
          />
        ),
      },
    ],
    // campaignActions reads the latest `saving` on every render of the cell.
    [saving]
  );

  async function load() {
    if (!organizationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [nextCampaigns, nextTemplates, nextLists] = await Promise.all([
        api.listCampaigns(organizationId),
        api.listTemplates(organizationId),
        api.listContactLists(organizationId)
      ]);
      setCampaigns(nextCampaigns);
      setTemplates(nextTemplates);
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

  function openCreateCampaign() {
    setEditingCampaign(null);
    setCampaignForm(emptyCampaignForm);
    setCampaignDialogOpen(true);
  }

  function openEditCampaign(campaign: Campaign) {
    setEditingCampaign(campaign);
    setCampaignForm({
      name: campaign.name,
      templateId: campaign.templateId ?? "",
      contactListId: campaign.contactListId ?? ""
    });
    setCampaignDialogOpen(true);
  }

  function closeCampaignDialog(open: boolean) {
    setCampaignDialogOpen(open);
    if (!open) {
      setEditingCampaign(null);
      setCampaignForm(emptyCampaignForm);
    }
  }

  async function saveCampaign(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) return;

    setSaving(true);
    try {
      if (editingCampaign) {
        await api.updateCampaign(editingCampaign.id, campaignForm);
        toast.success("Campaign updated.");
      } else {
        await api.createCampaign({
          organizationId,
          ...campaignForm
        });
        toast.success("Campaign draft created.");
      }
      setCampaignDialogOpen(false);
      setEditingCampaign(null);
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

  async function confirmDuplicate() {
    if (!duplicateTarget) return;
    setSaving(true);
    try {
      await api.duplicateCampaign(duplicateTarget.id);
      toast.success("Campaign duplicated as a new draft.");
      setDuplicateTarget(null);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to duplicate campaign"
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

  function openSchedule(campaign: Campaign) {
    setScheduleTarget(campaign);
    setScheduledAt(
      campaign.scheduledAt ? toDatetimeLocal(campaign.scheduledAt) : ""
    );
    if (campaign.cronExpression) {
      setRecurring(true);
      setRecurrence(
        parseCron(
          campaign.cronExpression,
          campaign.timezone ?? BROWSER_TIMEZONE
        )
      );
    } else {
      setRecurring(false);
      setRecurrence(emptyRecurrence);
    }
  }

  async function schedule(event: FormEvent) {
    event.preventDefault();
    if (!scheduleTarget) return;

    setSaving(true);
    try {
      if (recurring) {
        const cron = buildCron(recurrence);
        if (!describeCron(cron)) {
          toast.error("Enter a valid schedule.");
          setSaving(false);
          return;
        }
        await api.setCampaignRecurrence(scheduleTarget.id, {
          cronExpression: cron,
          timezone: recurrence.timezone
        });
        toast.success("Recurring schedule saved.");
      } else {
        await api.scheduleCampaign(
          scheduleTarget.id,
          new Date(scheduledAt).toISOString()
        );
        toast.success("Campaign scheduled.");
      }
      setScheduleTarget(null);
      setScheduledAt("");
      setRecurring(false);
      setRecurrence(emptyRecurrence);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to schedule campaign"
      );
    } finally {
      setSaving(false);
    }
  }

  async function togglePause(campaign: Campaign) {
    setSaving(true);
    try {
      if (campaign.status === "PAUSED") {
        await api.resumeCampaign(campaign.id);
        toast.success("Campaign resumed.");
      } else {
        await api.pauseCampaign(campaign.id);
        toast.success("Campaign paused.");
      }
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to update campaign"
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
          <Button
            type="button"
            onClick={openCreateCampaign}
            disabled={!organizationId || templates.length === 0 || contactLists.length === 0}
          >
            <Plus className="h-4 w-4" />
            New campaign
          </Button>
        }
      />

      <CampaignsTabs />

      <section className="p-4 sm:p-6">
        <DataGrid
          label="Campaigns"
          data={filteredCampaigns}
          columns={campaignColumns}
          getRowId={(row) => row.id}
          loading={loading}
          searchPlaceholder="Search campaigns…"
          toolbar={
            <div className="flex flex-wrap items-center gap-1">
              {STATUS_FILTERS.map((filter) => {
                const count = campaigns.filter((campaign) =>
                  filter.match(campaign.status)
                ).length;
                return (
                  <Button
                    key={filter.value}
                    type="button"
                    size="sm"
                    variant={
                      statusFilter === filter.value ? "secondary" : "ghost"
                    }
                    onClick={() => setStatusFilter(filter.value)}
                  >
                    {filter.label}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {count}
                    </span>
                  </Button>
                );
              })}
            </div>
          }
          empty={
            <EmptyState
              icon={Megaphone}
              title={
                campaigns.length === 0
                  ? "No campaigns yet"
                  : `No ${activeFilter.label.toLowerCase()} campaigns`
              }
              description={
                campaigns.length === 0
                  ? "A campaign sends one email to a whole list. Make a list and a template first, then draft one here."
                  : "Pick a different status above to see the rest."
              }
            />
          }
          noResults={
            <EmptyState
              icon={Megaphone}
              title="No matching campaigns"
              description="Try a different search."
            />
          }
          renderMobileRow={(campaign) => (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{campaign.name}</div>
                <div className="truncate text-sm text-muted-foreground">
                  {campaign.template?.subject ?? "No template"}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge variant={statusVariant(campaign.status)}>
                    {campaign.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {campaign.contactList?.name ?? "No list"}
                  </span>
                </div>
              </div>
              <RowActions
                rowLabel={campaign.name}
                actions={campaignActions(campaign)}
              />
            </div>
          )}
        />
      </section>

      <Dialog open={campaignDialogOpen} onOpenChange={closeCampaignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingCampaign ? "Edit campaign" : "New campaign"}
            </DialogTitle>
            <DialogDescription>
              Choose the template and audience for this campaign draft.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveCampaign} className="space-y-4">
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
                {editingCampaign ? "Save changes" : "Create draft"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={scheduleTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setScheduleTarget(null);
            setRecurring(false);
            setRecurrence(emptyRecurrence);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule campaign</DialogTitle>
            <DialogDescription>
              Pick a one-time send or set a recurring campaign cadence.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={schedule} className="space-y-4">
            <ScheduleControls
              scheduledAt={scheduledAt}
              onScheduledAtChange={setScheduledAt}
              recurring={recurring}
              onRecurringChange={setRecurring}
              recurrence={recurrence}
              onRecurrenceChange={setRecurrence}
              recurringHelp="Keep this campaign sending on a regular cadence."
            />

            <DialogFooter>
              <Button type="submit" disabled={saving}>
                {saving ? <Spinner /> : null}
                {recurring ? "Save schedule" : "Schedule"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={duplicateTarget !== null}
        onOpenChange={(open) => !open && setDuplicateTarget(null)}
        title="Duplicate campaign?"
        description={`A new draft "Copy of ${duplicateTarget?.name}" will be created with the same template and contact list.`}
        confirmLabel="Duplicate"
        destructive={false}
        loading={saving}
        onConfirm={confirmDuplicate}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete campaign?"
        description={`"${deleteTarget?.name}" will be permanently removed.`}
        confirmLabel="Delete"
        loading={saving}
        onConfirm={confirmDelete}
      />
    </>
  );
}
