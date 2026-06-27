import { CalendarClock, Repeat } from "lucide-react";
import cronstrue from "cronstrue";
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
import { Switch } from "./ui/switch.js";
import { cn } from "../lib/utils.js";

export const BROWSER_TIMEZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export const TIMEZONES: string[] = (() => {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
  ).supportedValuesOf;
  const list = supported ? supported("timeZone") : ["UTC"];
  return list.includes(BROWSER_TIMEZONE)
    ? list
    : [BROWSER_TIMEZONE, ...list];
})();

const WEEKDAYS = [
  { value: "0", short: "S", label: "Sunday" },
  { value: "1", short: "M", label: "Monday" },
  { value: "2", short: "T", label: "Tuesday" },
  { value: "3", short: "W", label: "Wednesday" },
  { value: "4", short: "T", label: "Thursday" },
  { value: "5", short: "F", label: "Friday" },
  { value: "6", short: "S", label: "Saturday" }
] as const;

export type RecurrencePreset = "daily" | "weekly" | "monthly" | "advanced";

export interface RecurrenceForm {
  preset: RecurrencePreset;
  time: string;
  weekdays: string[];
  dayOfMonth: string;
  cronExpression: string;
  timezone: string;
}

export const emptyRecurrence: RecurrenceForm = {
  preset: "daily",
  time: "09:00",
  weekdays: ["1"],
  dayOfMonth: "1",
  cronExpression: "",
  timezone: BROWSER_TIMEZONE
};

export function buildCron(form: RecurrenceForm): string {
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

export function parseCron(cron: string, timezone: string): RecurrenceForm {
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

export function describeCron(cron: string): string | null {
  if (!cron) return null;
  try {
    return cronstrue.toString(cron, { throwExceptionOnParseError: true });
  } catch {
    return null;
  }
}

export function scheduleSummary(value: string, timezone = BROWSER_TIMEZONE) {
  if (!value) return "Choose when this should send.";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Choose a valid date and time.";
  return `Will send on ${new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone
  }).format(date)} ${timezone}`;
}

export function recurrenceSummary(form: RecurrenceForm) {
  const description = describeCron(buildCron(form));
  if (!description) return "Enter a valid schedule.";
  return `Repeats ${description.toLowerCase()} ${form.timezone}`;
}

interface ToggleRowProps {
  icon: typeof CalendarClock;
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

function ToggleRow({
  icon: Icon,
  title,
  description,
  checked,
  onCheckedChange,
  disabled
}: ToggleRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border bg-card p-3">
      <div className="flex min-w-0 gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <Label
            className="cursor-pointer text-sm font-semibold"
            onClick={() => {
              if (!disabled) {
                onCheckedChange(!checked);
              }
            }}
          >
            {title}
          </Label>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={title}
      />
    </div>
  );
}

interface ScheduleControlsProps {
  scheduleEnabled?: boolean;
  onScheduleEnabledChange?: (enabled: boolean) => void;
  scheduledAt: string;
  onScheduledAtChange: (value: string) => void;
  recurring: boolean;
  onRecurringChange: (enabled: boolean) => void;
  recurrence: RecurrenceForm;
  onRecurrenceChange: (value: RecurrenceForm) => void;
  scheduleLabel?: string;
  recurringDisabled?: boolean;
  recurringHelp?: string;
  // Hide the recurring controls entirely (e.g. on one-off Compose sends, where
  // recurrence isn't supported yet). Defaults to shown.
  showRecurring?: boolean;
  className?: string;
}

export function ScheduleControls({
  scheduleEnabled,
  onScheduleEnabledChange,
  scheduledAt,
  onScheduledAtChange,
  recurring,
  onRecurringChange,
  recurrence,
  onRecurrenceChange,
  scheduleLabel = "Schedule for later",
  recurringDisabled = false,
  recurringHelp = "Send this again on a predictable rhythm.",
  showRecurring = true,
  className
}: ScheduleControlsProps) {
  const scheduleVisible = scheduleEnabled ?? !recurring;
  const canToggleSchedule = onScheduleEnabledChange !== undefined;
  const cronDescription = describeCron(buildCron(recurrence));

  return (
    <div className={cn("space-y-3", className)}>
      {canToggleSchedule ? (
        <ToggleRow
          icon={CalendarClock}
          title={scheduleLabel}
          description="Pick a date and time instead of sending immediately."
          checked={Boolean(scheduleEnabled)}
          onCheckedChange={onScheduleEnabledChange}
        />
      ) : null}

      {scheduleVisible && !recurring ? (
        <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
          <Label htmlFor="scheduledAt">Send at</Label>
          <Input
            id="scheduledAt"
            aria-label="Scheduled time"
            type="datetime-local"
            value={scheduledAt}
            onChange={(event) => onScheduledAtChange(event.target.value)}
            required={!canToggleSchedule || Boolean(scheduleEnabled)}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            {scheduleSummary(scheduledAt, BROWSER_TIMEZONE)}
          </p>
        </div>
      ) : null}

      {showRecurring ? (
        <ToggleRow
          icon={Repeat}
          title="Repeat on a schedule"
          description={recurringHelp}
          checked={recurring}
          onCheckedChange={onRecurringChange}
          disabled={recurringDisabled}
        />
      ) : null}

      {showRecurring && recurring ? (
        <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
          <div className="space-y-2">
            <Label>Frequency</Label>
            <Select
              value={recurrence.preset}
              onValueChange={(value) =>
                onRecurrenceChange({
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
                <SelectItem value="advanced">Advanced</SelectItem>
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
                  onRecurrenceChange({
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
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label>Repeat on</Label>
                    <div className="flex flex-wrap gap-1">
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
                            onRecurrenceChange({
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
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAYS.map((day) => {
                      const selected = recurrence.weekdays.includes(day.value);
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
                            onRecurrenceChange({
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
                        onRecurrenceChange({
                          ...recurrence,
                          dayOfMonth: event.target.value
                        })
                      }
                    />
                  </div>
                ) : null}
                <div className="space-y-2">
                  <Label htmlFor="scheduleTime">Time</Label>
                  <Input
                    id="scheduleTime"
                    type="time"
                    value={recurrence.time}
                    onChange={(event) =>
                      onRecurrenceChange({
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
              className="flex h-10 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={recurrence.timezone}
              onChange={(event) =>
                onRecurrenceChange({
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

          <div
            className={cn(
              "rounded-lg border bg-card px-3 py-2 text-sm leading-6",
              !cronDescription && "border-destructive/30 text-destructive"
            )}
          >
            {cronDescription ? recurrenceSummary(recurrence) : "Enter a valid schedule."}
          </div>
        </div>
      ) : null}
    </div>
  );
}
