import { FormEvent, useEffect, useState } from "react";
import { AlertTriangle, Gauge, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader.js";
import {
  api,
  type DeliverabilityAlerts,
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

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

export function Deliverability() {
  const { currentOrganizationId: organizationId } = useSession();
  const [overview, setOverview] = useState<DeliverabilityOverview | null>(null);
  const [alerts, setAlerts] = useState<DeliverabilityAlerts["alerts"]>([]);
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
      const [overviewData, alertsData, domainsData, policy, throttleData] =
        await Promise.all([
          api.deliverabilityOverview(organizationId),
          api.deliverabilityAlerts(organizationId),
          api.deliverabilityDomains(organizationId),
          api.getSuppressionPolicy(organizationId),
          api.listDomainThrottles(organizationId)
        ]);
      setOverview(overviewData);
      setAlerts(alertsData.alerts);
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
        title="Deliverability"
        description="Sending health over the last 30 days, plus auto-suppression and throttle controls."
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
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {[
                  { label: "Sent", value: String(overview.totals.sent) },
                  { label: "Delivery rate", value: pct(overview.rates.delivery) },
                  { label: "Bounce rate", value: pct(overview.rates.bounce) },
                  {
                    label: "Complaint rate",
                    value: pct(overview.rates.complaint)
                  },
                  { label: "Opens", value: String(overview.totals.opened) },
                  { label: "Clicks", value: String(overview.totals.clicked) },
                  {
                    label: "Hard / soft bounces",
                    value: `${overview.totals.hardBounced} / ${overview.totals.softBounced}`
                  },
                  {
                    label: "Suppressed",
                    value: String(overview.totals.suppressed)
                  }
                ].map((stat) => (
                  <Card key={stat.label} className="p-4">
                    <div className="text-xs text-muted-foreground">
                      {stat.label}
                    </div>
                    <div className="mt-1 text-2xl font-semibold">
                      {stat.value}
                    </div>
                  </Card>
                ))}
              </div>
            )}

            <Card className="overflow-hidden">
              <div className="border-b p-4 font-medium">By recipient domain</div>
              {domains && domains.domains.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Domain</TableHead>
                      <TableHead>Sent</TableHead>
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
                        <TableCell>{row.sent}</TableCell>
                        <TableCell>{row.bounced}</TableCell>
                        <TableCell>{pct(row.bounceRate)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
