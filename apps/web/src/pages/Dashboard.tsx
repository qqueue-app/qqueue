import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Info, Mail, Plus, Send } from "lucide-react";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { GetStartedCard } from "../components/GetStartedCard.js";
import { StatCard } from "../components/StatCard.js";
import { SetupChecklist, setupSteps } from "../components/SetupChecklist.js";
import { api, type DashboardSummary } from "../lib/api.js";
import { formatTimestamp } from "../lib/format.js";
import { qk } from "../lib/query-client.js";
import { useOrgQuery } from "../lib/use-api.js";
import { fetchSetupStatus } from "../lib/setup-status.js";
import { useSession } from "../lib/session-context.js";
import { Badge } from "../components/ui/badge.js";
import { DataGrid } from "../components/ui/data-grid.js";
import {
  Alert,
  AlertDescription,
  AlertTitle
} from "../components/ui/alert.js";

type RecentJob = DashboardSummary["recentEmailJobs"][number];

/**
 * Statuses read as sentences, not as enum members. "SENT" in a badge is the
 * database shouting; this is a mail client.
 */
const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  QUEUED: "Queued",
  PROCESSING: "Sending",
  SENT: "Sent",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  SUPPRESSED: "Suppressed"
};

function statusLabel(status: string) {
  return (
    STATUS_LABEL[status] ??
    status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ")
  );
}

/**
 * Tinted badge per §3 — background and text from a matching token pair, never a
 * solid saturated pill. Only FAILED is bad news: a cancelled or suppressed send
 * is a decision that was honoured, so it stays neutral rather than borrowing
 * red and making a clean queue look alarming.
 */
function statusVariant(status: string) {
  switch (status) {
    case "SENT":
      return "ok" as const;
    case "FAILED":
      return "err" as const;
    case "PROCESSING":
    case "QUEUED":
      return "warn" as const;
    default:
      return "neutral" as const;
  }
}

export function Dashboard() {
  const { currentOrganizationId: organizationId } = useSession();
  const [instanceSetupCompleted, setInstanceSetupCompleted] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchSetupStatus()
      .then((status) => {
        if (!cancelled) {
          setInstanceSetupCompleted(status.setupCompleted);
        }
      })
      .catch(() => {
        // Unknown state: don't nag about setup.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const summaryQuery = useOrgQuery(
    organizationId,
    qk.dashboard(organizationId ?? ""),
    (id) => api.dashboardSummary(id)
  );
  const summary = summaryQuery.data ?? null;
  const loading = summaryQuery.isPending && Boolean(organizationId);

  const steps = useMemo(() => setupSteps(summary?.setup), [summary?.setup]);

  const cards = useMemo(
    () => [
      {
        label: "Emails today",
        value: summary?.counts.emailsToday ?? 0,
        context: "Queued or sent since midnight"
      },
      {
        label: "Failed today",
        value: summary?.counts.failedToday ?? 0,
        // The context line carries the reassurance so the red value doesn't
        // have to be the only thing that changes between the two states.
        context: (summary?.counts.failedToday ?? 0) > 0
          ? "Needs attention"
          : "Nothing failed today",
        alarmWhenNonZero: true
      },
      {
        label: "Processing",
        value: summary?.counts.processingEmails ?? 0,
        context: "In flight right now"
      },
      {
        label: "Contacts",
        value: summary?.counts.contacts ?? 0,
        context: "Available recipients"
      },
      {
        label: "Templates",
        value: summary?.counts.templates ?? 0,
        context: "Reusable messages"
      },
      {
        label: "Sending accounts",
        value: summary?.counts.smtpConnections ?? 0,
        context: summary?.defaultSmtpConnection
          ? `Default: ${summary.defaultSmtpConnection.name}`
          : "No default sender"
      }
    ],
    [summary]
  );

  const columns = useMemo<ColumnDef<RecentJob, unknown>[]>(
    () => [
      {
        accessorKey: "toEmail",
        header: "Recipient",
        meta: { title: "Recipient" },
        cell: ({ row }) => (
          <span className="block max-w-cell truncate font-medium text-text">
            {row.original.toEmail}
          </span>
        )
      },
      {
        accessorKey: "subject",
        header: "Subject",
        meta: { title: "Subject" },
        cell: ({ row }) => (
          <span className="block max-w-cell-lg truncate text-text-secondary">
            {row.original.subject || "(no subject)"}
          </span>
        )
      },
      {
        accessorKey: "status",
        header: "Status",
        meta: { title: "Status" },
        cell: ({ row }) => (
          <Badge variant={statusVariant(row.original.status)}>
            {statusLabel(row.original.status)}
          </Badge>
        )
      },
      {
        id: "sentAs",
        accessorFn: (row) => row.smtpConnectionName ?? "Default",
        header: "Sent as",
        meta: { title: "Sent as", hideBelowLg: true },
        cell: ({ row }) => (
          <span className="text-text-secondary">
            {row.original.smtpConnectionName ?? "Default"}
          </span>
        )
      },
      {
        id: "when",
        // Sorted on the instant, displayed as a stamp — sorting the formatted
        // string would put "Aug" before "Jul".
        accessorFn: (row) =>
          new Date(row.sentAt ?? row.createdAt).getTime(),
        header: "Time",
        meta: { title: "Time", align: "right" },
        cell: ({ row }) => {
          const stamp = row.original.sentAt ?? row.original.createdAt;
          return (
            <time dateTime={stamp} className="text-text-secondary">
              {formatTimestamp(stamp, "Not sent")}
            </time>
          );
        }
      }
    ],
    []
  );

  // A brand-new org sees a guided first-send flow instead of the (all-zero)
  // stat grid and setup checklist. Sending the first email graduates them to
  // the full dashboard.
  const hasSent = (summary?.recentEmailJobs?.length ?? 0) > 0;
  const showOnboarding =
    !loading && Boolean(organizationId) && Boolean(summary) && !hasSent;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Today's sending at a glance, and the most recent send attempts."
        menuActions={[
          { label: "New template", to: "/templates", icon: Plus },
          {
            label: "Send email",
            to: "/email-studio",
            icon: Mail,
            // One primary per view (§3). While the first-run guide is up it
            // owns the loud button — its active step is the actual next thing
            // to do, and two accent buttons pointing different directions is
            // how a first-run screen stops having an obvious start.
            primary: !showOnboarding
          }
        ]}
      />

      <section className="space-y-6 p-4 sm:p-6">
        {!organizationId ? (
          <Alert variant="info">
            <Info />
            <AlertTitle>No organization selected</AlertTitle>
            <AlertDescription>
              Choose or create an organization in Settings to see your stats.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {showOnboarding ? (
              <GetStartedCard
                summary={summary}
                instanceSetupCompleted={instanceSetupCompleted}
              />
            ) : (
              <>
                {/*
                  Nothing until the answer is known. `setupSteps(undefined)`
                  reads as four missing steps, so rendering it mid-flight
                  flashes "0/4 ready · Still to set up: …" at an organization
                  that finished all of this months ago.
                */}
                {summary ? <SetupChecklist steps={steps} /> : null}
                {/*
                  1120px (§2). Six cards across an unbounded main on a 27"
                  monitor become six wide bands of whitespace with a number
                  parked at the left edge of each.
                */}
                <div className="grid max-w-grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {cards.map((card) => (
                    <StatCard key={card.label} {...card} loading={loading} />
                  ))}
                </div>
              </>
            )}

            <section aria-labelledby="recent-jobs" className="max-w-table">
              <h2
                id="recent-jobs"
                className="text-section font-semibold text-text"
              >
                Recent email jobs
              </h2>
              <p className="mt-1 text-ui text-text-secondary">
                The latest send attempts for this organization.
              </p>
              {/*
                No search box: this window is the most recent jobs, not every
                job, so a field that found nothing would be reporting on the
                truncation rather than on your mail. Outbox and the campaign
                views are where you go looking for a specific send.
              */}
              <DataGrid
                className="mt-4"
                label="Recent email jobs"
                data={summary?.recentEmailJobs ?? []}
                columns={columns}
                getRowId={(row) => row.id}
                loading={loading}
                searchable={false}
                pageSize={50}
                empty={
                  <EmptyState
                    icon={Send}
                    title="No email jobs yet"
                    description="Send your first email and it will show up here."
                  />
                }
                renderMobileRow={(job) => (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate text-body font-medium text-text">
                        {job.toEmail}
                      </span>
                      <Badge variant={statusVariant(job.status)}>
                        {statusLabel(job.status)}
                      </Badge>
                    </div>
                    <div className="truncate text-ui text-text-secondary">
                      {job.subject || "(no subject)"}
                    </div>
                    <div className="flex items-center justify-between gap-2 text-meta text-text-tertiary">
                      <span className="truncate">
                        {job.smtpConnectionName ?? "Default"}
                      </span>
                      <time dateTime={job.sentAt ?? job.createdAt}>
                        {formatTimestamp(
                          job.sentAt ?? job.createdAt,
                          "Not sent"
                        )}
                      </time>
                    </div>
                  </div>
                )}
              />
            </section>
          </>
        )}
      </section>
    </>
  );
}
