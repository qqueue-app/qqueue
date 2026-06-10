import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
import cronstrue from "cronstrue";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import {
  api,
  type Campaign,
  type ContactList,
  type Template
} from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card } from "../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../components/ui/dialog.js";
import { Checkbox } from "../components/ui/checkbox.js";
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
  templateId: "",
  contactListId: ""
};

function statusVariant(status: string) {
  if (status === "SENT") return "success" as const;
  if (status === "SENDING") return "warning" as const;
  if (status === "CANCELLED") return "destructive" as const;
  return "secondary" as const;
}

const BROWSER_TIMEZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const TIMEZONES: string[] = (() => {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
  ).supportedValuesOf;
  const list = supported ? supported("timeZone") : ["UTC"];
  return list.includes(BROWSER_TIMEZONE)
    ? list
    : [BROWSER_TIMEZONE, ...list];
})();

// Sunday-first, matching the iPhone alarm layout (S M T W T F S).
const WEEKDAYS = [
  { value: "0", short: "S", label: "Sunday" },
  { value: "1", short: "M", label: "Monday" },
  { value: "2", short: "T", label: "Tuesday" },
  { value: "3", short: "W", label: "Wednesday" },
  { value: "4", short: "T", label: "Thursday" },
  { value: "5", short: "F", label: "Friday" },
  { value: "6", short: "S", label: "Saturday" }
] as const;

type RecurrencePreset = "daily" | "weekly" | "monthly" | "advanced";

const emptyRecurrence = {
  preset: "daily" as RecurrencePreset,
  time: "09:00",
  weekdays: ["1"] as string[],
  dayOfMonth: "1",
  cronExpression: "",
  timezone: BROWSER_TIMEZONE
};

/** Build a 5-field cron expression from the recurrence form. */
function buildCron(form: typeof emptyRecurrence): string {
  if (form.preset === "advanced") {
    return form.cronExpression.trim();
  }
  const [hours, minutes] = form.time.split(":");
  const min = String(Number(minutes ?? 0));
  const hr = String(Number(hours ?? 0));
  if (form.preset === "daily") return `${min} ${hr} * * *`;
  if (form.preset === "weekly") {
    if (form.weekdays.length === 0) return "";
    const days = [...form.weekdays]
      .map(Number)
      .sort((a, b) => a - b)
      .join(",");
    return `${min} ${hr} * * ${days}`;
  }
  return `${min} ${hr} ${form.dayOfMonth} * *`;
}

/**
 * Reverse of buildCron: turn a stored cron expression back into the recurrence
 * form. Falls back to "advanced" (raw cron) for shapes the presets can't model.
 */
function parseCron(cron: string, timezone: string): typeof emptyRecurrence {
  const advanced = {
    ...emptyRecurrence,
    preset: "advanced" as RecurrencePreset,
    cronExpression: cron,
    timezone
  };

  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return advanced;
  const [min, hr, dom, mon, dow] = fields;

  const isPlainInt = (value: string) => /^\d+$/.test(value);
  if (!isPlainInt(min) || !isPlainInt(hr) || mon !== "*") return advanced;
  const time = `${hr.padStart(2, "0")}:${min.padStart(2, "0")}`;

  if (dom === "*" && dow === "*") {
    return { ...emptyRecurrence, preset: "daily", time, timezone };
  }
  if (dom === "*" && /^[0-6](,[0-6])*$/.test(dow)) {
    return {
      ...emptyRecurrence,
      preset: "weekly",
      time,
      weekdays: dow.split(","),
      timezone
    };
  }
  if (isPlainInt(dom) && dow === "*") {
    return {
      ...emptyRecurrence,
      preset: "monthly",
      time,
      dayOfMonth: dom,
      timezone
    };
  }
  return advanced;
}

/** Human-readable description of a cron expression, or null if unparseable. */
function describeCron(cron: string): string | null {
  if (!cron) return null;
  try {
    return cronstrue.toString(cron, { throwExceptionOnParseError: true });
  } catch {
    return null;
  }
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

      <section className="p-6">
        <Card className="overflow-hidden">
          {loading ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : campaigns.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title="No campaigns yet"
              description="Create a contact list and template, then draft your first campaign."
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1.5 border-b p-3">
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
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {count}
                      </span>
                    </Button>
                  );
                })}
              </div>
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
                {filteredCampaigns.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No {activeFilter.label.toLowerCase()} campaigns.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredCampaigns.map((campaign) => (
                  <TableRow key={campaign.id}>
                    <TableCell>
                      <div className="font-medium">{campaign.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {campaign.template?.subject ?? "No template"}
                      </div>
                      {campaign.cronExpression ? (
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Repeat className="h-3 w-3" />
                          <span>
                            {describeCron(campaign.cronExpression) ??
                              campaign.cronExpression}
                            {campaign.nextRunAt &&
                            campaign.status !== "PAUSED"
                              ? ` · next ${new Date(campaign.nextRunAt).toLocaleString()}`
                              : ""}
                          </span>
                        </div>
                      ) : null}
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
                          asChild
                          variant="ghost"
                          size="icon"
                          aria-label="View analytics"
                        >
                          <Link to={`/campaigns/${campaign.id}/analytics`}>
                            <BarChart3 className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={saving || campaign.status !== "DRAFT"}
                          onClick={() => openEditCampaign(campaign)}
                          aria-label="Edit campaign"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={saving}
                          onClick={() => setDuplicateTarget(campaign)}
                          aria-label="Duplicate campaign"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
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
                          disabled={saving || !["DRAFT", "SCHEDULED", "PAUSED"].includes(campaign.status)}
                          onClick={() => openSchedule(campaign)}
                          aria-label="Schedule campaign"
                        >
                          <CalendarClock className="h-4 w-4" />
                        </Button>
                        {["SCHEDULED", "SENDING", "PAUSED"].includes(
                          campaign.status
                        ) ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={saving}
                            onClick={() => togglePause(campaign)}
                            aria-label={
                              campaign.status === "PAUSED"
                                ? "Resume campaign"
                                : "Pause campaign"
                            }
                          >
                            {campaign.status === "PAUSED" ? (
                              <Play className="h-4 w-4" />
                            ) : (
                              <Pause className="h-4 w-4" />
                            )}
                          </Button>
                        ) : null}
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
                  ))
                )}
              </TableBody>
            </Table>
            </>
          )}
        </Card>
      </section>

      <Dialog open={campaignDialogOpen} onOpenChange={closeCampaignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingCampaign ? "Edit campaign" : "New campaign"}
            </DialogTitle>
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
          </DialogHeader>
          <form onSubmit={schedule} className="space-y-4">
            <label className="flex items-center gap-2.5 text-sm font-medium">
              <Checkbox
                checked={recurring}
                onCheckedChange={(value) => setRecurring(value === true)}
              />
              Repeat on a schedule
            </label>

            {!recurring ? (
              <div className="space-y-2">
                <Label htmlFor="scheduledAt">Send at</Label>
                <Input
                  id="scheduledAt"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(event) => setScheduledAt(event.target.value)}
                  required={!recurring}
                />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Frequency</Label>
                  <Select
                    value={recurrence.preset}
                    onValueChange={(value) =>
                      setRecurrence({
                        ...recurrence,
                        preset: value as RecurrencePreset
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="advanced">
                        Advanced (cron expression)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {recurrence.preset === "advanced" ? (
                  <div className="space-y-2">
                    <Label htmlFor="cronExpression">Cron expression</Label>
                    <Input
                      id="cronExpression"
                      placeholder="0 9 * * 1"
                      value={recurrence.cronExpression}
                      onChange={(event) =>
                        setRecurrence({
                          ...recurrence,
                          cronExpression: event.target.value
                        })
                      }
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    {recurrence.preset === "weekly" ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label>Repeat on</Label>
                          <div className="flex gap-1">
                            {(
                              [
                                { label: "Weekdays", days: ["1", "2", "3", "4", "5"] },
                                { label: "Weekend", days: ["0", "6"] },
                                {
                                  label: "Every day",
                                  days: ["0", "1", "2", "3", "4", "5", "6"]
                                }
                              ] as const
                            ).map((quick) => (
                              <Button
                                key={quick.label}
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={() =>
                                  setRecurrence({
                                    ...recurrence,
                                    weekdays: [...quick.days]
                                  })
                                }
                              >
                                {quick.label}
                              </Button>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-1.5">
                          {WEEKDAYS.map((day) => {
                            const selected = recurrence.weekdays.includes(
                              day.value
                            );
                            return (
                              <Button
                                key={day.value}
                                type="button"
                                size="icon"
                                variant={selected ? "default" : "outline"}
                                className="h-9 w-9 rounded-full"
                                aria-label={day.label}
                                aria-pressed={selected}
                                onClick={() =>
                                  setRecurrence({
                                    ...recurrence,
                                    weekdays: selected
                                      ? recurrence.weekdays.filter(
                                          (value) => value !== day.value
                                        )
                                      : [...recurrence.weekdays, day.value]
                                  })
                                }
                              >
                                {day.short}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                    <div className="grid gap-3 sm:grid-cols-2">
                      {recurrence.preset === "monthly" ? (
                        <div className="space-y-2">
                          <Label htmlFor="dayOfMonth">Day of month</Label>
                          <Input
                            id="dayOfMonth"
                            type="number"
                            min={1}
                            max={31}
                            value={recurrence.dayOfMonth}
                            onChange={(event) =>
                              setRecurrence({
                                ...recurrence,
                                dayOfMonth: event.target.value
                              })
                            }
                          />
                        </div>
                      ) : null}
                      <div className="space-y-2">
                        <Label htmlFor="time">Time</Label>
                        <Input
                          id="time"
                          type="time"
                          value={recurrence.time}
                          onChange={(event) =>
                            setRecurrence({
                              ...recurrence,
                              time: event.target.value
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="timezone">Timezone</Label>
                  <select
                    id="timezone"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    value={recurrence.timezone}
                    onChange={(event) =>
                      setRecurrence({
                        ...recurrence,
                        timezone: event.target.value
                      })
                    }
                  >
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                  {describeCron(buildCron(recurrence)) ? (
                    <span>
                      {describeCron(buildCron(recurrence))} ({recurrence.timezone})
                    </span>
                  ) : (
                    <span className="text-destructive">
                      Enter a valid cron expression.
                    </span>
                  )}
                </div>
              </div>
            )}

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
