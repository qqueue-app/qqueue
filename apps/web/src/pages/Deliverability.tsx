import { FormEvent, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Gauge, Info, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader.js";
import {
  api,
  deriveReputationAlerts,
  type DeliverabilityDomains,
  type DeliverabilityOverview,
  type DomainThrottle
} from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Spinner } from "../components/ui/spinner.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { Card } from "../components/ui/card.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
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
          api.listDomainThrottles(organizationId)
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
        softBounceWindowDays: Number(windowDays)
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
        maxPerMinute: Number(throttleRate)
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
      />

      <section className="space-y-6 p-6">
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
                <ul className="space-y-1 text-sm">
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
                      hint: "Recipients your server tried to send to."
                    },
                    {
                      label: "Accepted by server",
                      value: pct(overview.rates.accepted),
                      hint: "Handed off to the next hop without rejection."
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
                          : "Confirmed by an ESP webhook or a delivery notification."
                    },
                    {
                      label: "Bounce rate",
                      value: pct(overview.rates.bounce),
                      hint: `${overview.totals.bounced} of ${overview.totals.attempted} attempted`
                    },
                    {
                      label: "Complaint rate",
                      value: pct(overview.rates.complaint),
                      hint: `${overview.totals.complained} marked as spam`
                    },
                    {
                      label: "Open rate",
                      value: pct(overview.rates.open),
                      hint: `${overview.totals.opened} of ${overview.totals.sent} sent`
                    },
                    {
                      label: "Click rate",
                      value: pct(overview.rates.click),
                      hint: `${overview.totals.clicked} of ${overview.totals.sent} sent`
                    },
                    {
                      label: "Hard / soft / block",
                      value: `${overview.totals.hardBounced} / ${overview.totals.softBounced} / ${overview.totals.blockBounced}`,
                      hint: "Bounces by class."
                    }
                  ].map((stat) => (
                    <Card key={stat.label} className="p-4">
                      <div className="text-xs text-muted-foreground">
                        {stat.label}
                      </div>
                      <div className="mt-1 text-2xl font-semibold">
                        {stat.value}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {stat.hint}
                      </div>
                    </Card>
                  ))}
                </div>

                {/* An install with no ESP webhook and no DSNs cannot observe
                    delivery at all. Saying so is the honest alternative to
                    printing a number derived from open tracking. */}
                {overview.deliverySignal === "none" && (
                  <Card className="flex items-start gap-2 p-4 text-sm text-muted-foreground">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" />
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

                <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                  {[
                    ["Sent", overview.totals.sent],
                    ["Failed", overview.totals.failed],
                    ["Skipped (suppressed)", overview.totals.suppressedAtSend],
                    ["Still in flight", overview.totals.inFlight]
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

            <Card className="overflow-hidden">
              <div className="border-b p-4 font-medium">By recipient domain</div>
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
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="p-4 text-sm text-muted-foreground">
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
                  <p className="mb-3 text-xs text-muted-foreground">
                    {overview.totals.suppressedTotal} address
                    {overview.totals.suppressedTotal === 1 ? "" : "es"}{" "}
                    suppressed in total, {overview.totals.suppressedInWindow}{" "}
                    added in this window.
                  </p>
                )}
                <form onSubmit={savePolicy} className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="soft-threshold">Soft-bounce threshold</Label>
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
                <p className="mb-3 text-xs text-muted-foreground">
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
                    {savingThrottle ? <Spinner /> : <Plus className="h-4 w-4" />}
                    Add
                  </Button>
                </form>
                {throttles.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {throttles.map((throttle) => (
                      <li
                        key={throttle.id}
                        className="flex items-center justify-between rounded border px-3 py-1.5"
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
      </section>
    </>
  );
}
