import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { Pause, PenSquare, Play, Repeat, Trash2 } from "lucide-react";
import { PageHeader } from "../components/PageHeader.js";
import { CampaignsTabs } from "../components/CampaignsTabs.js";
import { EmptyState } from "../components/EmptyState.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { describeCron } from "../components/ScheduleControls.js";
import { api, type RecurringSend } from "../lib/api.js";
import { formatFullDate, formatTimestamp } from "../lib/format.js";
import { qk } from "../lib/query-client.js";
import { useApiMutation, useOrgQuery } from "../lib/use-api.js";
import { useSession } from "../lib/session-context.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { DataGrid } from "../components/ui/data-grid.js";
import { RowActions } from "../components/ui/row-actions.js";
import { Hint } from "../components/ui/tooltip.js";

/** The cron in words, falling back to the expression when it can't be parsed. */
function describeSchedule(send: RecurringSend) {
  return describeCron(send.cronExpression) ?? send.cronExpression;
}

/**
 * Recurring sends — messages that go out again on a schedule.
 *
 * They used to live in the composer's right rail, in a card that grew its own
 * scrollbar once you had more than three of them (§2's named example of the
 * rule it broke). They are scheduled campaigns, so §4 puts them here: their own
 * route, a real table, and a rail in Compose that once again holds nothing but
 * the options for the message you are writing.
 *
 * There is no create form on this page on purpose. A recurring send is composed
 * — sender, recipients, subject, body — and the composer already does all of
 * that; turning "Repeat on a schedule" on there is what lands a row here.
 */
export function RecurringSends() {
  const { currentOrganizationId: organizationId } = useSession();
  const navigate = useNavigate();
  const [deleteTarget, setDeleteTarget] = useState<RecurringSend | null>(null);

  const sendsQuery = useOrgQuery(
    organizationId,
    qk.recurringSends(organizationId ?? ""),
    (id) => api.listRecurringSends(id)
  );

  const invalidates = [qk.recurringSends(organizationId ?? "")];

  const toggle = useApiMutation(
    (send: RecurringSend) =>
      send.status === "ACTIVE"
        ? api.pauseRecurringSend(send.id)
        : api.resumeRecurringSend(send.id),
    {
      successMessage: (updated) =>
        updated.status === "ACTIVE"
          ? "Recurring send resumed."
          : "Recurring send paused.",
      errorMessage: "Couldn't update that schedule.",
      invalidates,
    }
  );

  const remove = useApiMutation(
    (send: RecurringSend) => api.deleteRecurringSend(send.id),
    {
      successMessage: "Recurring send deleted.",
      errorMessage: "Couldn't delete that schedule.",
      invalidates,
      onSuccess: () => setDeleteTarget(null),
    }
  );

  const busy = toggle.isPending || remove.isPending;

  function rowActions(send: RecurringSend) {
    return [
      {
        label:
          send.status === "ACTIVE"
            ? "Pause this schedule"
            : "Resume this schedule",
        icon: send.status === "ACTIVE" ? Pause : Play,
        primary: true,
        disabled: busy,
        onSelect: () => toggle.mutate(send),
      },
      {
        label: "Delete this schedule",
        icon: Trash2,
        destructive: true,
        disabled: busy,
        onSelect: () => setDeleteTarget(send),
      },
    ];
  }

  const columns = useMemo<ColumnDef<RecurringSend, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        meta: { title: "Name" },
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium text-text">
              {row.original.name}
            </div>
            <div className="truncate text-ui text-text-secondary">
              {row.original.subject}
            </div>
          </div>
        ),
      },
      {
        id: "schedule",
        accessorFn: (row) => describeSchedule(row),
        header: "Schedule",
        meta: { title: "Schedule", hideBelowMd: true },
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate text-text-secondary">
              {describeSchedule(row.original)}
            </div>
            <div className="truncate text-meta text-text-tertiary">
              {row.original.timezone}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "nextRunAt",
        header: "Next run",
        meta: { title: "Next run", align: "right", hideBelowLg: true },
        cell: ({ row }) => {
          // A paused schedule's stored nextRunAt is a date the worker will
          // never act on, so the column goes quiet rather than repeating what
          // the status badge one cell over already says.
          if (row.original.status !== "ACTIVE" || !row.original.nextRunAt) {
            return <span className="text-text-tertiary">—</span>;
          }
          return (
            <Hint label={formatFullDate(row.original.nextRunAt)}>
              <time
                dateTime={row.original.nextRunAt}
                className="cursor-help text-text-secondary"
              >
                {formatTimestamp(row.original.nextRunAt)}
              </time>
            </Hint>
          );
        },
      },
      {
        accessorKey: "status",
        header: "Status",
        meta: { title: "Status" },
        cell: ({ row }) => (
          <Badge variant={row.original.status === "ACTIVE" ? "ok" : "neutral"}>
            {row.original.status === "ACTIVE" ? "Active" : "Paused"}
          </Badge>
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
            actions={rowActions(row.original)}
          />
        ),
      },
    ],
    // The action handlers read the latest `busy` on every render of the cell.
    [busy]
  );

  return (
    <>
      <PageHeader
        title="Recurring sends"
        description="Emails that go out again on a schedule. Recipients are re-resolved on every run, so a growing list is picked up automatically."
        actions={
          <Button type="button" onClick={() => navigate("/email-studio")}>
            <PenSquare className="h-4 w-4" />
            New recurring send
          </Button>
        }
      />

      <CampaignsTabs />

      <section className="p-4 sm:p-6">
        <DataGrid
          label="Recurring sends"
          data={sendsQuery.data ?? []}
          columns={columns}
          getRowId={(row) => row.id}
          loading={sendsQuery.isPending}
          searchPlaceholder="Search recurring sends…"
          empty={
            <EmptyState
              icon={Repeat}
              title="No recurring sends yet"
              description="Turn on “Repeat on a schedule” while composing an email and it will appear here."
              action={
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => navigate("/email-studio")}
                >
                  <PenSquare className="h-4 w-4" />
                  Compose one
                </Button>
              }
            />
          }
          noResults={
            <EmptyState
              icon={Repeat}
              title="No matching schedules"
              description="Try a different search."
            />
          }
          renderMobileRow={(send) => (
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate text-body font-medium text-text">
                  {send.name}
                </span>
                <Badge variant={send.status === "ACTIVE" ? "ok" : "neutral"}>
                  {send.status === "ACTIVE" ? "Active" : "Paused"}
                </Badge>
              </div>
              <div className="text-ui text-text-secondary">
                {describeSchedule(send)}
              </div>
              <div className="flex items-end justify-between gap-2">
                <div className="min-w-0 text-meta text-text-tertiary">
                  <div className="truncate">{send.timezone}</div>
                  <div>
                    {send.status === "ACTIVE" && send.nextRunAt ? (
                      <>
                        Next run{" "}
                        <time dateTime={send.nextRunAt}>
                          {formatTimestamp(send.nextRunAt)}
                        </time>
                      </>
                    ) : (
                      "No next run"
                    )}
                  </div>
                </div>
                {/*
                  No hover-only affordance on a phone (§5): both actions are
                  reachable by tap, pause inline and delete in the ⋯ menu.
                */}
                <RowActions
                  rowLabel={send.name}
                  actions={rowActions(send)}
                  className="shrink-0"
                />
              </div>
            </div>
          )}
        />
      </section>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this recurring send?"
        description="It stops for good and no further copies go out. Emails it has already sent are unaffected."
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
      />
    </>
  );
}
