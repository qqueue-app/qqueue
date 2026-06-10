import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  Info,
  Mail,
  Plus,
  Send,
  Server,
  Users,
  XCircle,
  type LucideIcon
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { api, type DashboardSummary } from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent } from "../components/ui/card.js";
import { Skeleton } from "../components/ui/skeleton.js";
import {
  Alert,
  AlertDescription,
  AlertTitle
} from "../components/ui/alert.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../components/ui/table.js";

interface StatCard {
  label: string;
  value: number;
  detail: string;
  icon: LucideIcon;
  tone?: "default" | "danger";
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Not sent";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function statusVariant(status: string) {
  switch (status) {
    case "SENT":
      return "success";
    case "FAILED":
    case "CANCELLED":
      return "destructive";
    case "PROCESSING":
    case "QUEUED":
      return "warning";
    default:
      return "secondary";
  }
}

function setupItems(summary: DashboardSummary | null) {
  return [
    {
      label: "SMTP connection",
      ready: Boolean(summary?.setup.hasSmtpConnection),
      href: "/smtp-connections"
    },
    {
      label: "Default sender",
      ready: Boolean(summary?.setup.hasDefaultSmtp),
      href: "/smtp-connections"
    },
    {
      label: "Contacts",
      ready: Boolean(summary?.setup.hasContacts),
      href: "/contacts"
    },
    {
      label: "Templates",
      ready: Boolean(summary?.setup.hasTemplates),
      href: "/templates"
    }
  ];
}

export function Dashboard() {
  const { currentOrganizationId: organizationId } = useSession();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!organizationId) {
      setSummary(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    api
      .dashboardSummary(organizationId)
      .then(setSummary)
      .catch((error: unknown) =>
        toast.error(
          error instanceof Error ? error.message : "Unable to load dashboard"
        )
      )
      .finally(() => setLoading(false));
  }, [organizationId]);

  const cards: StatCard[] = useMemo(
    () => [
      {
        label: "Emails today",
        value: summary?.counts.emailsToday ?? 0,
        detail: "Queued or sent today",
        icon: Send
      },
      {
        label: "Failed today",
        value: summary?.counts.failedToday ?? 0,
        detail: "Needs attention",
        icon: AlertCircle,
        tone: "danger"
      },
      {
        label: "Processing",
        value: summary?.counts.processingEmails ?? 0,
        detail: "Currently in progress",
        icon: Clock
      },
      {
        label: "Contacts",
        value: summary?.counts.contacts ?? 0,
        detail: "Available recipients",
        icon: Users
      },
      {
        label: "Templates",
        value: summary?.counts.templates ?? 0,
        detail: "Reusable messages",
        icon: FileText
      },
      {
        label: "SMTP connections",
        value: summary?.counts.smtpConnections ?? 0,
        detail: summary?.defaultSmtpConnection
          ? `Default: ${summary.defaultSmtpConnection.name}`
          : "No default sender",
        icon: Server
      }
    ],
    [summary]
  );

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Overview of sending activity, setup health, and recent platform events."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/templates">
                <Plus className="h-4 w-4" />
                Template
              </Link>
            </Button>
            <Button asChild>
              <Link to="/send-email">
                <Mail className="h-4 w-4" />
                Send email
              </Link>
            </Button>
          </div>
        }
      />
      <section className="space-y-6 p-6">
        {!organizationId ? (
          <Alert variant="info">
            <Info />
            <AlertTitle>No organization selected</AlertTitle>
            <AlertDescription>
              Choose or create an organization in Settings to see your stats.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <Card key={card.label}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm text-muted-foreground">
                        {card.label}
                      </div>
                      {loading ? (
                        <Skeleton className="mt-3 h-8 w-14" />
                      ) : (
                        <div className="mt-2 text-3xl font-semibold tracking-tight">
                          {card.value}
                        </div>
                      )}
                    </div>
                    <div
                      className={
                        card.tone === "danger"
                          ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive"
                          : "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                      }
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                  </div>
                  <div className="mt-3 truncate text-xs text-muted-foreground">
                    {loading ? <Skeleton className="h-4 w-24" /> : card.detail}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Setup health</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Required pieces before regular sending.
                  </p>
                </div>
                <Badge variant={setupItems(summary).every((item) => item.ready) ? "success" : "warning"}>
                  {setupItems(summary).filter((item) => item.ready).length}/4 ready
                </Badge>
              </div>
              <div className="mt-5 space-y-3">
                {setupItems(summary).map((item) => (
                  <Link
                    key={item.label}
                    to={item.href}
                    className="flex items-center justify-between rounded-md border p-3 text-sm transition-colors hover:bg-muted/50"
                  >
                    <span className="font-medium">{item.label}</span>
                    {loading ? (
                      <Skeleton className="h-5 w-16" />
                    ) : item.ready ? (
                      <span className="flex items-center gap-1.5 text-success">
                        <CheckCircle2 className="h-4 w-4" />
                        Ready
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-warning">
                        <XCircle className="h-4 w-4" />
                        Missing
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="border-b p-5">
                <h2 className="font-semibold">Recent email jobs</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Latest send attempts for this organization.
                </p>
              </div>
              {loading ? (
                <div className="space-y-3 p-5">
                  {[0, 1, 2].map((index) => (
                    <Skeleton key={index} className="h-10 w-full" />
                  ))}
                </div>
              ) : summary?.recentEmailJobs.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>SMTP</TableHead>
                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.recentEmailJobs.map((job) => (
                      <TableRow key={job.id}>
                        <TableCell className="font-medium">{job.toEmail}</TableCell>
                        <TableCell className="max-w-[220px] truncate">
                          {job.subject}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(job.status)}>
                            {job.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{job.smtpConnectionName ?? "Default"}</TableCell>
                        <TableCell>{formatDate(job.sentAt ?? job.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState
                  icon={Send}
                  title="No email jobs yet"
                  description="Send your first email to see it here."
                />
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4">
          <Card>
            <CardContent className="p-0">
              <div className="border-b p-5">
                <h2 className="font-semibold">Recent events</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Queue and delivery events recorded by the API.
                </p>
              </div>
              {loading ? (
                <div className="space-y-3 p-5">
                  {[0, 1, 2].map((index) => (
                    <Skeleton key={index} className="h-12 w-full" />
                  ))}
                </div>
              ) : summary?.recentEvents.length ? (
                <div className="divide-y">
                  {summary.recentEvents.map((event) => (
                    <div key={event.id} className="flex gap-3 p-4">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <Mail className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={statusVariant(event.type)}>
                            {event.type}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(event.occurredAt)}
                          </span>
                        </div>
                        <div className="mt-1 truncate text-sm font-medium">
                          {event.emailJob.subject}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {event.emailJob.toEmail}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={Mail}
                  title="No events recorded yet"
                  description="Queue and delivery events will appear here."
                />
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </>
  );
}
