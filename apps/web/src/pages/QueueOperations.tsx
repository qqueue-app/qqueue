import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, RefreshCw, RotateCcw, ShieldAlert } from "lucide-react";
import {
  api,
  type QueueJob,
  type QueueOperationsSummary,
} from "../lib/api.js";
import { formatFullDate } from "../lib/format.js";
import { qk } from "../lib/query-client.js";
import { useApiMutation, useOrgQuery } from "../lib/use-api.js";
import { useSession } from "../lib/session-context.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent } from "../components/ui/card.js";
import { DataGrid } from "../components/ui/data-grid.js";
import { RowActions } from "../components/ui/row-actions.js";
import { Hint } from "../components/ui/tooltip.js";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs.js";
import { PageContainer } from "../components/PageContainer.js";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { Skeleton } from "../components/ui/skeleton.js";

/** Plain-language names for the queues, so the page isn't a wall of slugs. */
const QUEUE_LABELS: Record<string, string> = {
  "email-sending": "Sending email",
  "campaign-processing": "Building campaigns",
  "webhook-delivery": "Webhooks",
  "inbox-sync": "Checking mailboxes",
  "recurring-send": "Recurring sends",
};

function queueLabel(name: string) {
  return QUEUE_LABELS[name] ?? name;
}

type JobKind = "queued" | "processing" | "failed";

/**
 * Background jobs — the admin view of the BullMQ queues, for when something
 * looks stuck. The product-level view of pending mail lives in the Outbox;
 * this is deliberately the raw one.
 */
export function QueueOperations() {
  const { currentOrganizationId: organizationId } = useSession();
  const [retryingKey, setRetryingKey] = useState<string | null>(null);

  const queuesQuery = useOrgQuery(
    organizationId,
    qk.queueOperations(organizationId ?? ""),
    (id) => api.queueOperations(id),
    {
      refetchInterval: 15_000,
      retry: false,
      // A 403 here is expected for members and is explained inline below, so
      // the global "couldn't load" toast would just be noise on top of it.
      meta: { silent: true },
    }
  );

  const retry = useApiMutation(
    (job: QueueJob) =>
      api.retryQueueJob(job.queueName, job.id, organizationId as string),
    {
      successMessage: "Job queued to run again.",
      errorMessage: "Couldn't retry that job.",
      invalidates: [qk.queueOperations(organizationId ?? "")],
      onSuccess: () => setRetryingKey(null),
      onError: () => setRetryingKey(null),
    }
  );

  // Read the status by shape rather than `instanceof ApiError` so the check
  // survives an error crossing a module boundary.
  const forbidden =
    (queuesQuery.error as { status?: number } | null)?.status === 403;

  const columns = useMemo<ColumnDef<QueueJob, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Job",
        /*
          The cap belongs on the cell, not on the div inside it. A BullMQ repeat
          id ("repeat:campaign-recurring-<cuid>:<epoch>") is one unbreakable
          token, and an auto-layout table sizes a column to its content's
          *min-content* width — which `truncate` does not reduce, because
          `text-overflow` needs a definite width to work against. So the column
          grew to fit the id and pushed the whole table out past its card: 1357px
          of content in a 1280px window, the sideways scroll §7 rules out.
        */
        meta: { title: "Job", cellClassName: "max-w-cell-lg" },
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{row.original.name}</div>
            <div className="truncate font-mono text-eyebrow text-muted-foreground">
              {row.original.id}
            </div>
            {row.original.failedReason ? (
              <Hint label={row.original.failedReason}>
                <div className="mt-1 max-w-cell-lg cursor-help truncate text-meta text-destructive">
                  {row.original.failedReason}
                </div>
              </Hint>
            ) : null}
          </div>
        ),
      },
      {
        id: "data",
        accessorFn: (row) => JSON.stringify(row.data),
        header: "Details",
        meta: {
          title: "Details",
          hideBelowLg: true,
          cellClassName: "max-w-cell"
        },
        enableSorting: false,
        cell: ({ getValue }) => (
          <Hint label={String(getValue())}>
            <code className="block cursor-help truncate rounded-control bg-muted px-2 py-1 text-meta">
              {String(getValue())}
            </code>
          </Hint>
        ),
      },
      {
        id: "attempts",
        accessorFn: (row) => row.attemptsMade,
        header: "Tries",
        meta: { title: "Tries", align: "center", hideBelowMd: true },
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.attemptsMade}/{row.original.attempts || "—"}
          </span>
        ),
      },
      {
        id: "updated",
        accessorFn: (row) => row.finishedOn ?? row.processedOn ?? row.timestamp,
        header: "Last activity",
        meta: { title: "Last activity", hideBelowMd: true },
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">
            {formatFullDate(getValue() as string | null, "Not started")}
          </span>
        ),
      },
    ],
    []
  );

  const failedColumns = useMemo<ColumnDef<QueueJob, unknown>[]>(
    () => [
      ...columns,
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
                label: "Run this job again",
                icon: RotateCcw,
                primary: true,
                disabled:
                  retryingKey ===
                  `${row.original.queueName}:${row.original.id}`,
                onSelect: () => {
                  setRetryingKey(
                    `${row.original.queueName}:${row.original.id}`
                  );
                  retry.mutate(row.original);
                },
              },
            ]}
          />
        ),
      },
    ],
    [columns, retry, retryingKey]
  );

  function JobGrid({
    queue,
    kind,
  }: {
    queue: QueueOperationsSummary;
    kind: JobKind;
  }) {
    const jobs =
      kind === "queued"
        ? queue.queuedJobs
        : kind === "processing"
          ? queue.processingJobs
          : queue.failedJobs;

    return (
      <DataGrid
        label={`${queueLabel(queue.name)} — ${kind} jobs`}
        data={jobs}
        columns={kind === "failed" ? failedColumns : columns}
        getRowId={(row) => `${row.queueName}:${row.id}`}
        pageSize={10}
        searchPlaceholder="Search jobs…"
        empty={
          <EmptyState
            icon={CheckCircle2}
            title={
              kind === "failed"
                ? "Nothing has failed"
                : kind === "processing"
                  ? "Nothing running right now"
                  : "Nothing waiting"
            }
            description={
              kind === "failed"
                ? "Jobs that give up after their retries land here."
                : undefined
            }
          />
        }
        renderMobileRow={(job) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{job.name}</div>
            <div className="truncate font-mono text-eyebrow text-muted-foreground">
              {job.id}
            </div>
            {job.failedReason ? (
              <p className="mt-1 line-clamp-2 text-meta text-destructive">
                {job.failedReason}
              </p>
            ) : null}
            {kind === "failed" ? (
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => retry.mutate(job)}
              >
                <RotateCcw className="h-4 w-4" />
                Run again
              </Button>
            ) : null}
          </div>
        )}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Background jobs"
        description="What QQueue is working through behind the scenes. Come here when something looks stuck."
        breadcrumb={{ label: "Settings", to: "/settings" }}
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => void queuesQuery.refetch()}
            disabled={queuesQuery.isFetching}
          >
            <RefreshCw
              className={queuesQuery.isFetching ? "animate-spin" : undefined}
            />
            Refresh
          </Button>
        }
      />

      <PageContainer className="space-y-6">
        {queuesQuery.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : forbidden ? (
          <Card>
            <EmptyState
              icon={ShieldAlert}
              title="Owners and admins only"
              description="Background jobs are visible to organization owners and admins. Ask one of them if you need access."
            />
          </Card>
        ) : (
          (queuesQuery.data ?? []).map((queue) => (
            <Card key={queue.name}>
              <CardContent className="p-4 sm:p-card">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{queueLabel(queue.name)}</h2>
                    <p className="font-mono text-meta text-muted-foreground">
                      {queue.name}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-field">
                    <Hint label="Jobs waiting their turn">
                      <Badge variant="secondary" className="cursor-help">
                        {queue.counts.queued} waiting
                      </Badge>
                    </Hint>
                    <Hint label="Jobs running right now">
                      <Badge variant="secondary" className="cursor-help">
                        {queue.counts.processing} running
                      </Badge>
                    </Hint>
                    <Hint label="Jobs that gave up after their retries">
                      <Badge
                        variant={
                          queue.counts.failed ? "destructive" : "secondary"
                        }
                        className="cursor-help"
                      >
                        {queue.counts.failed} failed
                      </Badge>
                    </Hint>
                  </div>
                </div>

                <Tabs
                  defaultValue={queue.counts.failed > 0 ? "failed" : "queued"}
                  className="mt-4"
                >
                  <TabsList>
                    <TabsTrigger value="queued">
                      Waiting ({queue.counts.queued})
                    </TabsTrigger>
                    <TabsTrigger value="processing">
                      Running ({queue.counts.processing})
                    </TabsTrigger>
                    <TabsTrigger value="failed">
                      Failed ({queue.counts.failed})
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="queued">
                    <JobGrid queue={queue} kind="queued" />
                  </TabsContent>
                  <TabsContent value="processing">
                    <JobGrid queue={queue} kind="processing" />
                  </TabsContent>
                  <TabsContent value="failed">
                    <JobGrid queue={queue} kind="failed" />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          ))
        )}
      </PageContainer>
    </>
  );
}
