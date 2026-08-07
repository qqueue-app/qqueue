import cronstrue from "cronstrue";
import { Button } from "./ui/button.js";
import { fieldBase, fieldControlHeight } from "./ui/field.js";
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
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

/**
 * A settings row (§3): label and description on the left, control on the right,
 * hairline between rows.
 *
 * Deliberately *not* a bordered box with an icon tile, which is what this used
 * to be. These controls render inside a card — the composer's send-options rail
 * — and a bordered box inside a card is a card inside a card. The icon tile
 * went with it: a calendar glyph next to the words "Schedule for later" is
 * decoration, and §6 rules that out.
 */
function ToggleRow({
  title,
  description,
  checked,
  onCheckedChange,
  disabled
}: ToggleRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-3 first:pt-0 last:border-0 last:pb-0">
      <div className="min-w-0">
        <Label
          className="cursor-pointer"
          onClick={() => {
            if (!disabled) {
              onCheckedChange(!checked);
            }
          }}
        >
          {title}
        </Label>
        <p className="mt-1 text-meta leading-5 text-text-tertiary">
          {description}
        </p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={title}
        className="mt-1 shrink-0"
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
    <div className={cn("space-y-0", className)}>
      {canToggleSchedule ? (
        <ToggleRow
          title={scheduleLabel}
          description="Pick a date and time instead of sending immediately."
          checked={Boolean(scheduleEnabled)}
          onCheckedChange={onScheduleEnabledChange}
        />
      ) : null}

      {/*
        Revealed detail hangs under the switch that turned it on, separated by
        space rather than by a second border — the container these render in is
        already a surface.
      */}
      {scheduleVisible && !recurring ? (
        <div className="space-y-field pb-4 pt-3">
          <Label htmlFor="scheduledAt">Send at</Label>
          <Input
            id="scheduledAt"
            aria-label="Scheduled time"
            type="datetime-local"
            value={scheduledAt}
            onChange={(event) => onScheduledAtChange(event.target.value)}
            required={!canToggleSchedule || Boolean(scheduleEnabled)}
          />
          <p className="text-meta leading-5 text-text-tertiary">
            {scheduleSummary(scheduledAt, BROWSER_TIMEZONE)}
          </p>
        </div>
      ) : null}

      {showRecurring ? (
        <ToggleRow
          title="Repeat on a schedule"
          description={recurringHelp}
          checked={recurring}
          onCheckedChange={onRecurringChange}
          disabled={recurringDisabled}
        />
      ) : null}

      {showRecurring && recurring ? (
        <div className="space-y-4 pb-1 pt-4">
          <div className="space-y-field">
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
            <div className="space-y-field">
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
            <div className="space-y-4">
              {recurrence.preset === "weekly" ? (
                <div className="space-y-field">
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
                          className="px-2"
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
                  <div className="flex flex-wrap gap-field">
                    {WEEKDAYS.map((day) => {
                      const selected = recurrence.weekdays.includes(day.value);
                      return (
                        <Button
                          key={day.value}
                          type="button"
                          size="icon"
                          variant={selected ? "primary" : "secondary"}
                          // 36px like every other control, with the button's
                          // own pseudo-element carrying the 44px tap area.
                          className="h-control w-control rounded-pill"
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

              {/* Two short numeric fields, so they share a row (§2) and each is
                  sized to what it holds rather than to the container. */}
              <div className="flex flex-col gap-4 xs:flex-row xs:gap-4">
                {recurrence.preset === "monthly" ? (
                  <div className="space-y-field">
                    <Label htmlFor="dayOfMonth">Day of month</Label>
                    <Input
                      id="dayOfMonth"
                      type="number"
                      inputMode="numeric"
                      width="code"
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
                <div className="space-y-field">
                  <Label htmlFor="scheduleTime">Time</Label>
                  <Input
                    id="scheduleTime"
                    type="time"
                    width="code"
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

          <div className="space-y-field">
            <Label htmlFor="timezone">Timezone</Label>
            {/*
              A native <select>, not the Radix one: there are ~400 timezones,
              and a phone's own picker handles that list far better than a
              popover can. Styled from the shared field tokens so it still
              matches every other control on the page.
            */}
            <select
              id="timezone"
              className={cn(fieldBase, fieldControlHeight, "pr-8")}
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

          <p
            className={cn(
              "text-meta leading-5",
              cronDescription ? "text-text-tertiary" : "text-err"
            )}
          >
            {cronDescription ? recurrenceSummary(recurrence) : "Enter a valid schedule."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
