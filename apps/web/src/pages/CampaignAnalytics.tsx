import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Ban,
  Link2,
  Mail,
  MousePointerClick,
  Send,
  ShieldAlert,
  type LucideIcon
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { api, type CampaignAnalytics as CampaignAnalyticsData } from "../lib/api.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent } from "../components/ui/card.js";
import { Skeleton } from "../components/ui/skeleton.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../components/ui/table.js";

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function statusVariant(status: string) {
  switch (status) {
    case "SENT":
    case "OPENED":
    case "CLICKED":
    case "DELIVERED":
      return "success" as const;
    case "FAILED":
    case "CANCELLED":
    case "BOUNCED":
    case "COMPLAINED":
      return "destructive" as const;
    case "PROCESSING":
    case "QUEUED":
    case "SENDING":
      return "warning" as const;
    default:
      return "secondary" as const;
  }
}

interface StatCard {
  label: string;
  value: number;
  detail: string;
  icon: LucideIcon;
  tone?: "default" | "danger";
}

export function CampaignAnalytics() {
  const { id } = useParams<{ id: string }>();
  const [analytics, setAnalytics] = useState<CampaignAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      return;
    }
    setLoading(true);
    api
      .campaignAnalytics(id)
      .then(setAnalytics)
      .catch((error: unknown) =>
        toast.error(
          error instanceof Error ? error.message : "Unable to load analytics"
        )
      )
      .finally(() => setLoading(false));
  }, [id]);

  const cards: StatCard[] = useMemo(() => {
    const totals = analytics?.totals;
    const rates = analytics?.rates;
    return [
      {
        label: "Sent",
        value: totals?.sent ?? 0,
        detail: `${totals?.recipients ?? 0} recipients`,
        icon: Send
      },
      {
        label: "Opens",
        value: totals?.uniqueOpened ?? 0,
        detail: `${formatPercent(rates?.open ?? 0)} open rate · ${totals?.opened ?? 0} total`,
        icon: Mail
      },
      {
        label: "Clicks",
        value: totals?.uniqueClicked ?? 0,
        detail: `${formatPercent(rates?.click ?? 0)} click rate · ${totals?.clicked ?? 0} total`,
        icon: MousePointerClick
      },
      {
        label: "Bounced",
        value: totals?.bounced ?? 0,
        detail: `${formatPercent(rates?.bounce ?? 0)} bounce rate`,
        icon: Ban,
        tone: "danger"
      },
      {
        label: "Complaints",
        value: totals?.complained ?? 0,
        detail: "Marked as spam",
        icon: ShieldAlert,
        tone: "danger"
      },
      {
        label: "Failed",
        value: totals?.failed ?? 0,
        detail: "Send errors",
        icon: ShieldAlert,
        tone: "danger"
      }
    ];
  }, [analytics]);

  return (
    <>
      <PageHeader
        title={analytics ? `${analytics.campaign.name} · Analytics` : "Campaign analytics"}
        description="Opens, clicks, and bounces recorded for this campaign."
        actions={
          <Button asChild variant="outline">
            <Link to="/campaigns">
              <ArrowLeft className="h-4 w-4" />
              Campaigns
            </Link>
          </Button>
        }
      />
      <section className="space-y-6 p-6">
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

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardContent className="p-0">
              <div className="border-b p-5">
                <h2 className="font-semibold">Top links</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Clicks per destination URL.
                </p>
              </div>
              {loading ? (
                <div className="space-y-3 p-5">
                  {[0, 1, 2].map((index) => (
                    <Skeleton key={index} className="h-8 w-full" />
                  ))}
                </div>
              ) : analytics?.links.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>URL</TableHead>
                      <TableHead className="text-right">Clicks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analytics.links.map((link) => (
                      <TableRow key={link.url}>
                        <TableCell className="max-w-[360px] truncate font-medium">
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline"
                          >
                            {link.url}
                          </a>
                        </TableCell>
                        <TableCell className="text-right">{link.clicks}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState
                  icon={Link2}
                  title="No clicks yet"
                  description="Link clicks will appear here once recipients engage."
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="border-b p-5">
                <h2 className="font-semibold">Recent events</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Latest delivery activity for this campaign.
                </p>
              </div>
              {loading ? (
                <div className="space-y-3 p-5">
                  {[0, 1, 2].map((index) => (
                    <Skeleton key={index} className="h-12 w-full" />
                  ))}
                </div>
              ) : analytics?.recentEvents.length ? (
                <div className="divide-y">
                  {analytics.recentEvents.map((event) => (
                    <div key={event.id} className="flex items-center gap-3 p-4">
                      <Badge variant={statusVariant(event.type)}>
                        {event.type}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {event.toEmail}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDate(event.occurredAt)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={Mail}
                  title="No events yet"
                  description="Opens, clicks, and bounces will appear here."
                />
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </>
  );
}
