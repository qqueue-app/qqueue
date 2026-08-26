import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Gauge,
  Info,
  MailWarning,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "../components/PageContainer.js";
import { PageHeader } from "../components/PageHeader.js";
import {
  api,
  deriveReputationAlerts,
  type DeliverabilityDomains,
  type DeliverabilityOverview,
  type DomainThrottle,
  type UnattributedBounce,
} from "../lib/api.js";
import { formatFullDate, formatMailDate } from "../lib/format.js";
import { qk } from "../lib/query-client.js";
import { useOrgQuery } from "../lib/use-api.js";
import { useSession } from "../lib/session-context.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Spinner } from "../components/ui/spinner.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { Card } from "../components/ui/card.js";
import { Badge } from "../components/ui/badge.js";
import { DataGrid, type DataGridColumn } from "../components/ui/data-grid.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.js";

/**
 * A rate of `null` has no denominator — no sends, or no delivery signal at all.
 * It renders as an em dash: showing 0.0% would claim a measurement nobody took,
 * which is the failure mode this whole page was rebuilt to avoid.
 */
const pct = (value: number | null) =>
  value === null ? "—" : `${(value * 100).toFixed(1)}%`;

export function Deliverability() {
  const { currentOrganizationId: organizationId } = useSession();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<DeliverabilityOverview | null>(null);
  const [domains, setDomains] = useState<DeliverabilityDomains | null>(null);
  const [throttles, setThrottles] = useState<DomainThrottle[]>([]);
  const [defaultPerMinute, setDefaultPerMinute] = useState<number>(60);
  const [threshold, setThreshold] = useState("3");
  const [windowDays, setWindowDays] = useState("30");
  const [throttleDomain, setThrottleDomain] = useState("");
  const [throttleRate, setThrottleRate] = useState("60");
  const [loading, setLoading] = useState(true);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [savingThrottle, setSavingThrottle] = useState(false);

  const unattributedQuery = useOrgQuery(
    organizationId,
    qk.unattributedBounces(organizationId ?? ""),
    (id) => api.unattributedBounces(id)
  );

  const unattributedColumns = useMemo<DataGridColumn<UnattributedBounce>[]>(
    () => [
      {
        accessorKey: "recipient",
        header: "Failed recipient",
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.recipient ?? "Unknown recipient"}
          </span>
        ),
      },
      {
        accessorKey: "mailbox",
        header: "Mailbox",
        meta: { hideBelowMd: true },
      },
      {
        id: "failure",
        header: "Failure",
        accessorFn: (row) => [row.status, row.reason].filter(Boolean).join(" "),
        cell: ({ row }) => (
          <div className="max-w-cell-lg">
            <div className="flex items-center gap-2">
              <Badge variant="warn">Not a QQueue send</Badge>
              {row.original.suppressed ? (
                <Badge variant="err">Blocked</Badge>
              ) : null}
              {row.original.status ? (
                <span className="text-meta text-muted-foreground" data-numeric>
                  {row.original.status}
                </span>
              ) : null}
            </div>
            <p className="mt-1 truncate text-meta text-muted-foreground">
              {row.original.reason ?? "Open the notice for details."}
            </p>
          </div>
        ),
      },
      {
        accessorKey: "receivedAt",
        header: "Received",
        cell: ({ row }) => formatMailDate(row.original.receivedAt),
        meta: { align: "right" },
      },
    ],
    []
  );

  async function load() {
    if (!organizationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Alerts are derived from the overview rather than fetched: the endpoint
      // recomputes the entire overview aggregation to produce them, so asking
      // for both doubled the query cost for a list we can compute here.
      const [overviewData, domainsData, policy, throttleData] =
        await Promise.all([
          api.deliverabilityOverview(organizationId),
          api.deliverabilityDomains(organizationId),
          api.getSuppressionPolicy(organizationId),
          api.listDomainThrottles(organizationId),
        ]);
      setOverview(overviewData);
      setDomains(domainsData);
      setThreshold(String(policy.softBounceThreshold));
      setWindowDays(String(policy.softBounceWindowDays));
      setThrottles(throttleData.throttles);
      setDefaultPerMinute(throttleData.defaultPerMinute);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load deliverability"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [organizationId]);

  const alerts = useMemo(
    () => (overview ? deriveReputationAlerts(overview) : []),
    [overview]
  );

  async function savePolicy(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) return;
    setSavingPolicy(true);
    try {
      await api.updateSuppressionPolicy({
        organizationId,
        softBounceThreshold: Number(threshold),
        softBounceWindowDays: Number(windowDays),
      });
      toast.success("Auto-suppression policy saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save.");
    } finally {
      setSavingPolicy(false);
    }
  }

  async function addThrottle(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) return;
    setSavingThrottle(true);
    try {
      await api.upsertDomainThrottle({
        organizationId,
        domain: throttleDomain.trim(),
        maxPerMinute: Number(throttleRate),
      });
      toast.success("Throttle saved.");
      setThrottleDomain("");
      setThrottleRate("60");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save.");
    } finally {
      setSavingThrottle(false);
    }
  }

  async function removeThrottle(id: string) {
    try {
      await api.deleteDomainThrottle(id);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete.");
    }
  }

  return (
    <>
      <PageHeader
        title="Sending health"
        description="How your email is landing over the last 30 days, plus auto-blocking and rate-limit controls."
        breadcrumb={{ label: "Sending accounts", to: "/settings/sending" }}
      />

      <PageContainer className="space-y-6">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : (
          <>
            {alerts.length > 0 && (
              <Card className="border-destructive/50 p-4">
                <div className="mb-2 flex items-center gap-2 font-medium text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  Reputation alerts
                </div>
                <ul className="space-y-1 text-body">
                  {alerts.map((alert) => (
                    <li key={alert.metric}>{alert.message}</li>
                  ))}
                </ul>
              </Card>
            )}

            {overview && (
              <>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  {[
                    {
                      label: "Attempted",
                      value: String(overview.totals.attempted),
                      hint: "Reached a recipient's mail server.",
                    },
                    {
                      label: "Accepted by server",
                      value: pct(overview.rates.accepted),
                      hint: "Handed off to the next hop without rejection.",
                    },
                    {
                      label: "Confirmed delivered",
                      value:
                        overview.deliverySignal === "none"
                          ? "—"
                          : pct(overview.rates.confirmedDelivery),
                      hint:
                        overview.deliverySignal === "none"
                          ? "No delivery confirmation source configured."
                          : "Confirmed by an ESP webhook or a delivery notification.",
                    },
                    {
                      label: "Bounce rate",
                      value: pct(overview.rates.bounce),
                      hint: `${overview.totals.bounced} of ${overview.totals.attempted} attempted`,
                    },
                    {
                      label: "Complaint rate",
                      value: pct(overview.rates.complaint),
                      hint: `${overview.totals.complained} marked as spam`,
                    },
                    {
                      label: "Open rate",
                      value: pct(overview.rates.open),
                      hint: `${overview.totals.opened} of ${overview.totals.sent} sent`,
                    },
                    {
                      label: "Click rate",
                      value: pct(overview.rates.click),
                      hint: `${overview.totals.clicked} of ${overview.totals.sent} sent`,
                    },
                    {
                      label: "Hard / soft / block",
                      value: `${overview.totals.hardBounced} / ${overview.totals.softBounced} / ${overview.totals.blockBounced}`,
                      hint: "Bounces by class.",
                    },
                  ].map((stat) => (
                    <Card key={stat.label} className="p-4">
                      <div className="text-meta text-muted-foreground">
                        {stat.label}
                      </div>
                      <div className="mt-1 text-stat font-semibold">
                        {stat.value}
                      </div>
                      <div className="mt-1 text-meta text-muted-foreground">
                        {stat.hint}
                      </div>
                    </Card>
                  ))}
                </div>

                {/* An install with no ESP webhook and no DSNs cannot observe
                    delivery at all. Saying so is the honest alternative to
                    printing a number derived from open tracking. */}
                {overview.deliverySignal === "none" && (
                  <Card className="flex items-start gap-2 p-4 text-body text-muted-foreground">
                    <Info className="mt-1 h-4 w-4 shrink-0" />
                    <p>
                      <span className="font-medium text-foreground">
                        No delivery confirmation yet.
                      </span>{" "}
                      A successful SMTP handoff means the next server accepted
                      the message, not that it reached the mailbox. Confirmed
                      delivery appears once an ESP posts delivery webhooks to
                      QQueue, or once your inbox account starts receiving
                      delivery notifications. Until then, use{" "}
                      <span className="font-medium text-foreground">
                        accepted
                      </span>{" "}
                      and{" "}
                      <span className="font-medium text-foreground">
                        bounce rate
                      </span>{" "}
                      as your signal.
                    </p>
                  </Card>
                )}

                {/* The rates above deliberately exclude sends that never
                    reached a recipient's mail server. Saying so is the point:
                    silently dropping them would leave the reputation numbers
                    describing a smaller send than the one you asked for. */}
                {overview.totals.failedBeforeHandoff > 0 && (
                  <Card className="flex items-start gap-2 border-amber-500/50 p-4 text-body text-muted-foreground">
                    <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-amber-600" />
                    <p>
                      <span className="font-medium text-foreground">
                        {overview.totals.failedBeforeHandoff} send
                        {overview.totals.failedBeforeHandoff === 1
                          ? ""
                          : "s"}{" "}
                        never left your server
                      </span>{" "}
                      ({pct(overview.rates.deliveryFailure)} of everything that
                      finished). No recipient server saw them, so they are not
                      counted in the rates above — that is a problem with the
                      sending account or the message, not with your reputation.
                      Check the sending account&apos;s credentials and{" "}
                      <span className="font-medium text-foreground">
                        Background jobs
                      </span>{" "}
                      for the error.
                    </p>
                  </Card>
                )}

                <div className="grid grid-cols-2 gap-4 text-body md:grid-cols-5">
                  {[
                    ["Sent", overview.totals.sent],
                    ["Bounced", overview.totals.bounced],
                    ["Never left", overview.totals.failedBeforeHandoff],
                    ["Skipped (suppressed)", overview.totals.suppressedAtSend],
                    ["Still in flight", overview.totals.inFlight],
                  ].map(([label, value]) => (
                    <div
                      key={String(label)}
                      className="flex items-baseline justify-between rounded border px-3 py-2"
                    >
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-medium">{value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <Card className="p-4">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <MailWarning className="h-4 w-4 text-amber-600" />
                <h2 className="font-medium">Unattributed bounces</h2>
                {(unattributedQuery.data?.bounces.length ?? 0) > 0 ? (
                  <Badge variant="warn">
                    {unattributedQuery.data?.bounces.length}
                  </Badge>
                ) : null}
              </div>
              <p className="mb-4 text-meta text-muted-foreground">
                Delivery failures received by your mailboxes that do not match a
                QQueue send. They are excluded from the bounce rate and do not
                automatically block the recipient. Older notices may show as
                blocked if they were processed before this safeguard.
              </p>
              <DataGrid
                label="Unattributed bounces"
                data={unattributedQuery.data?.bounces ?? []}
                columns={unattributedColumns}
                getRowId={(row) => row.id}
                loading={unattributedQuery.isPending}
                pageSize={10}
                searchPlaceholder="Search recipients or mailboxes…"
                empty={
                  <p className="p-4 text-body text-muted-foreground">
                    No unattributed bounce notices in the last 30 days.
                  </p>
                }
                onRowClick={(row) =>
                  navigate(
                    `/inbox?message=${encodeURIComponent(row.inboundMessageId)}`
                  )
                }
                getRowLabel={(row) =>
                  `Open delivery notice for ${row.recipient ?? "unknown recipient"}`
                }
                renderMobileRow={(row) => (
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {row.recipient ?? "Unknown recipient"}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge variant="warn">Not a QQueue send</Badge>
                      {row.suppressed ? (
                        <Badge variant="err">Blocked</Badge>
                      ) : null}
                      {row.status ? (
                        <span className="text-meta text-muted-foreground">
                          {row.status}
                        </span>
                      ) : null}
                      <span className="text-meta text-muted-foreground">
                        {formatFullDate(row.receivedAt)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-meta text-muted-foreground">
                      {row.reason ?? row.mailbox}
                    </p>
                  </div>
                )}
              />
            </Card>

            <Card className="overflow-hidden">
              <div className="border-b p-4 font-medium">
                By recipient domain
              </div>
              {domains && domains.domains.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Domain</TableHead>
                        <TableHead>Attempted</TableHead>
                        <TableHead>Accepted</TableHead>
                        <TableHead>Bounced</TableHead>
                        <TableHead>Bounce rate</TableHead>
                        <TableHead>Never left</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {domains.domains.map((row) => (
                        <TableRow key={row.domain}>
                          <TableCell className="font-medium">
                            {row.domain}
                          </TableCell>
                          <TableCell>{row.attempted}</TableCell>
                          <TableCell>{row.sent}</TableCell>
                          <TableCell>{row.bounced}</TableCell>
                          <TableCell>{pct(row.bounceRate)}</TableCell>
                          <TableCell
                            className={
                              row.failedBeforeHandoff > 0
                                ? "text-amber-600"
                                : "text-muted-foreground"
                            }
                          >
                            {row.failedBeforeHandoff}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="p-4 text-body text-muted-foreground">
                  No sends in this window yet.
                </p>
              )}
            </Card>

            <div className="grid gap-6 md:grid-cols-2">
              <Card className="p-4">
                <div className="mb-3 flex items-center gap-2 font-medium">
                  <Gauge className="h-4 w-4" />
                  Auto-suppression policy
                </div>
                {overview && (
                  <p className="mb-3 text-meta text-muted-foreground">
                    {overview.totals.suppressedTotal} address
                    {overview.totals.suppressedTotal === 1 ? "" : "es"}{" "}
                    suppressed in total, {overview.totals.suppressedInWindow}{" "}
                    added in this window.
                  </p>
                )}
                <form onSubmit={savePolicy} className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="soft-threshold">
                      Soft-bounce threshold
                    </Label>
                    <Input
                      id="soft-threshold"
                      type="number"
                      min={1}
                      value={threshold}
                      onChange={(e) => setThreshold(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="soft-window">Window (days)</Label>
                    <Input
                      id="soft-window"
                      type="number"
                      min={1}
                      value={windowDays}
                      onChange={(e) => setWindowDays(e.target.value)}
                    />
                  </div>
                  <Button type="submit" disabled={savingPolicy}>
                    {savingPolicy ? <Spinner /> : null}
                    Save policy
                  </Button>
                </form>
              </Card>

              <Card className="p-4">
                <div className="mb-1 font-medium">Per-domain throttles</div>
                <p className="mb-3 text-meta text-muted-foreground">
                  Default cap: {defaultPerMinute}/min. Add a domain to override.
                </p>
                <form
                  onSubmit={addThrottle}
                  className="mb-3 flex flex-wrap items-end gap-2"
                >
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="throttle-domain">Domain</Label>
                    <Input
                      id="throttle-domain"
                      identifier
                      inputMode="url"
                      placeholder="gmail.com"
                      value={throttleDomain}
                      onChange={(e) => setThrottleDomain(e.target.value)}
                      required
                    />
                  </div>
                  <div className="w-28 space-y-1">
                    <Label htmlFor="throttle-rate">Per minute</Label>
                    <Input
                      id="throttle-rate"
                      type="number"
                      min={1}
                      value={throttleRate}
                      onChange={(e) => setThrottleRate(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" disabled={savingThrottle}>
                    {savingThrottle ? (
                      <Spinner />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    Add
                  </Button>
                </form>
                {throttles.length > 0 && (
                  <ul className="space-y-1 text-body">
                    {throttles.map((throttle) => (
                      <li
                        key={throttle.id}
                        className="flex items-center justify-between rounded border px-3 py-field"
                      >
                        <span>
                          {throttle.domain || "(default)"} —{" "}
                          {throttle.maxPerMinute}/min
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Remove throttle"
                          onClick={() => removeThrottle(throttle.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </>
        )}
      </PageContainer>
    </>
  );
}
