import { useEffect, useState } from "react";
import { Inbox, RotateCcw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  ApiError,
  type QueueJob,
  type QueueOperationsSummary
} from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../components/ui/card.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../components/ui/table.js";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { Spinner } from "../components/ui/spinner.js";

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "Not started";
}

function JobTable({
  title,
  jobs,
  retrying,
  onRetry
}: {
  title: string;
  jobs: QueueJob[];
  retrying: string | null;
  onRetry?: (job: QueueJob) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">{title}</div>
      {jobs.length === 0 ? (
        <EmptyState icon={Inbox} title={`No ${title.toLowerCase()}`} />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Payload</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Updated</TableHead>
                {onRetry ? <TableHead className="w-24" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={`${job.queueName}-${job.id}`}>
                  <TableCell>
                    <div className="font-medium">{job.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {job.id}
                    </div>
                    {job.failedReason ? (
                      <div className="mt-1 max-w-xs truncate text-xs text-destructive">
                        {job.failedReason}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <code className="block max-w-sm truncate rounded bg-muted px-2 py-1 text-xs">
                      {JSON.stringify(job.data)}
                    </code>
                  </TableCell>
                  <TableCell>
                    {job.attemptsMade}/{job.attempts || "-"}
                  </TableCell>
                  <TableCell>
                    {formatDate(job.finishedOn ?? job.processedOn ?? job.timestamp)}
                  </TableCell>
                  {onRetry ? (
                    <TableCell>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={retrying === `${job.queueName}:${job.id}`}
                        onClick={() => onRetry(job)}
                      >
                        {retrying === `${job.queueName}:${job.id}` ? (
                          <Spinner />
                        ) : (
                          <RotateCcw className="h-4 w-4" />
                        )}
                        Retry
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export function QueueOperations() {
  const { currentOrganizationId } = useSession();
  const [queues, setQueues] = useState<QueueOperationsSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);

  async function load() {
    if (!currentOrganizationId) {
      return;
    }
    setQueues(await api.queueOperations(currentOrganizationId));
  }

  useEffect(() => {
    setForbidden(false);
    setLoading(true);
    load()
      .catch((error) => {
        if (error instanceof ApiError && error.status === 403) {
          setForbidden(true);
          return;
        }
        toast.error(
          error instanceof Error ? error.message : "Failed to load queues"
        );
      })
      .finally(() => setLoading(false));
  }, [currentOrganizationId]);

  async function retry(job: QueueJob) {
    if (!currentOrganizationId) {
      return;
    }
    const key = `${job.queueName}:${job.id}`;
    setRetrying(key);
    try {
      await api.retryQueueJob(job.queueName, job.id, currentOrganizationId);
      toast.success("Job queued for retry.");
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setForbidden(true);
        return;
      }
      toast.error(error instanceof Error ? error.message : "Retry failed");
    } finally {
      setRetrying(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Queue Operations"
        description="Inspect queued, processing, and failed background jobs."
        actions={
          <Button type="button" variant="outline" onClick={load}>
            Refresh
          </Button>
        }
      />

      {loading ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner />
            Loading queues...
          </CardContent>
        </Card>
      ) : forbidden ? (
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={ShieldAlert}
              title="Access restricted"
              description="Queue operations are available to organization owners and admins only. Ask an owner or admin if you need access."
            />
          </CardContent>
        </Card>
      ) : (
        queues.map((queue) => (
          <Card key={queue.name}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>{queue.name}</CardTitle>
                  <CardDescription>
                    Current BullMQ state for this queue.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">Queued {queue.counts.queued}</Badge>
                  <Badge variant="secondary">
                    Processing {queue.counts.processing}
                  </Badge>
                  <Badge variant={queue.counts.failed ? "destructive" : "secondary"}>
                    Failed {queue.counts.failed}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <JobTable
                title="Queued jobs"
                jobs={queue.queuedJobs}
                retrying={retrying}
              />
              <JobTable
                title="Processing jobs"
                jobs={queue.processingJobs}
                retrying={retrying}
              />
              <JobTable
                title="Failed jobs"
                jobs={queue.failedJobs}
                retrying={retrying}
                onRetry={retry}
              />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
