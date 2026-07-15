import { FormEvent, useEffect, useState } from "react";
import { Copy, KeyRound, LogOut, RotateCcw, Trash2, Webhook } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "../components/EmptyState.js";
import { InstanceSettingsCard } from "../components/InstanceSettingsCard.js";
import { PageHeader } from "../components/PageHeader.js";
import {
  api,
  outboundWebhookEvents,
  type ApiKey,
  type OutboundWebhookEvent,
  type WebhookDelivery,
  type WebhookEndpoint
} from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.js";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "../components/ui/alert-dialog.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "../components/ui/card.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Separator } from "../components/ui/separator.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../components/ui/select.js";
import { Spinner } from "../components/ui/spinner.js";
import { Switch } from "../components/ui/switch.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../components/ui/table.js";

const apiBaseUrl =
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "http://localhost:4000";

export function Settings() {
  const {
    user,
    organizations,
    currentOrganizationId,
    setCurrentOrganizationId,
    addOrganization,
    signOut: clearSessionState
  } = useSession();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [apiKeyName, setApiKeyName] = useState("");
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [creatingApiKey, setCreatingApiKey] = useState(false);
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [webhookEndpoints, setWebhookEndpoints] = useState<WebhookEndpoint[]>([]);
  const [webhooksLoading, setWebhooksLoading] = useState(false);
  const [webhookName, setWebhookName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEvents, setWebhookEvents] = useState<OutboundWebhookEvent[]>([
    "email.sent",
    "email.failed",
    "email.bounced"
  ]);
  const [creatingWebhook, setCreatingWebhook] = useState(false);
  const [createdWebhookSecret, setCreatedWebhookSecret] = useState<string | null>(
    null
  );
  const [deleteWebhookTarget, setDeleteWebhookTarget] =
    useState<WebhookEndpoint | null>(null);
  const [deletingWebhook, setDeletingWebhook] = useState(false);
  const [selectedWebhookEndpoint, setSelectedWebhookEndpoint] =
    useState<WebhookEndpoint | null>(null);
  const [webhookDeliveries, setWebhookDeliveries] = useState<WebhookDelivery[]>(
    []
  );
  const [webhookDeliveriesLoading, setWebhookDeliveriesLoading] =
    useState(false);
  const [retryingDeliveryId, setRetryingDeliveryId] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (!currentOrganizationId) {
      setApiKeys([]);
      setWebhookEndpoints([]);
      setSelectedWebhookEndpoint(null);
      setWebhookDeliveries([]);
      return;
    }

    let cancelled = false;
    setApiKeysLoading(true);
    api
      .listApiKeys(currentOrganizationId)
      .then((keys) => {
        if (!cancelled) {
          setApiKeys(keys);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(
            error instanceof Error ? error.message : "Unable to load API keys"
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setApiKeysLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentOrganizationId]);

  useEffect(() => {
    if (!currentOrganizationId) {
      setWebhookEndpoints([]);
      return;
    }

    let cancelled = false;
    setWebhooksLoading(true);
    api
      .listWebhookEndpoints(currentOrganizationId)
      .then((endpoints) => {
        if (!cancelled) {
          setWebhookEndpoints(endpoints);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Unable to load webhook endpoints"
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setWebhooksLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentOrganizationId]);

  async function createOrganization(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const organization = await api.createOrganization({ name });
      // Creator is always the OWNER; make the new org active immediately.
      addOrganization(
        { id: organization.id, name: organization.name, role: "OWNER" },
        true
      );
      setName("");
      toast.success(`Organization "${organization.name}" created.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to create organization"
      );
    } finally {
      setSaving(false);
    }
  }

  async function renameOrganization(event: FormEvent) {
    event.preventDefault();
    if (!currentOrganizationId || !renameValue.trim()) {
      return;
    }
    setRenaming(true);
    try {
      const organization = await api.updateOrganization(currentOrganizationId, {
        name: renameValue.trim()
      });
      const existingRole =
        organizations.find((org) => org.id === organization.id)?.role ??
        "OWNER";
      addOrganization(
        { id: organization.id, name: organization.name, role: existingRole },
        false
      );
      setRenameValue("");
      toast.success(`Organization renamed to "${organization.name}".`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to rename organization"
      );
    } finally {
      setRenaming(false);
    }
  }

  async function createApiKey(event: FormEvent) {
    event.preventDefault();
    if (!currentOrganizationId) {
      return;
    }

    setCreatingApiKey(true);
    try {
      const result = await api.createApiKey({
        organizationId: currentOrganizationId,
        name: apiKeyName
      });
      setApiKeys((current) => [result.apiKey, ...current]);
      setCreatedApiKey(result.key);
      setApiKeyName("");
      toast.success("API key created.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to create API key"
      );
    } finally {
      setCreatingApiKey(false);
    }
  }

  async function copyApiKey() {
    if (!createdApiKey) {
      return;
    }

    try {
      await navigator.clipboard.writeText(createdApiKey);
      toast.success("API key copied.");
    } catch {
      toast.error("Unable to copy API key.");
    }
  }

  async function revokeApiKey() {
    if (!revokeTarget) {
      return;
    }

    setRevoking(true);
    try {
      const revoked = await api.revokeApiKey(revokeTarget.id);
      setApiKeys((current) =>
        current.map((item) => (item.id === revoked.id ? revoked : item))
      );
      setRevokeTarget(null);
      toast.success("API key revoked.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to revoke API key"
      );
    } finally {
      setRevoking(false);
    }
  }

  async function createWebhookEndpoint(event: FormEvent) {
    event.preventDefault();
    if (!currentOrganizationId) {
      return;
    }

    setCreatingWebhook(true);
    try {
      const result = await api.createWebhookEndpoint({
        organizationId: currentOrganizationId,
        name: webhookName,
        url: webhookUrl,
        events: webhookEvents
      });
      setWebhookEndpoints((current) => [result.endpoint, ...current]);
      setCreatedWebhookSecret(result.secret);
      setWebhookName("");
      setWebhookUrl("");
      toast.success("Webhook endpoint created.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to create webhook endpoint"
      );
    } finally {
      setCreatingWebhook(false);
    }
  }

  async function copyWebhookSecret() {
    if (!createdWebhookSecret) {
      return;
    }

    try {
      await navigator.clipboard.writeText(createdWebhookSecret);
      toast.success("Webhook signing secret copied.");
    } catch {
      toast.error("Unable to copy webhook signing secret.");
    }
  }

  async function deleteWebhookEndpoint() {
    if (!deleteWebhookTarget) {
      return;
    }

    setDeletingWebhook(true);
    try {
      await api.deleteWebhookEndpoint(deleteWebhookTarget.id);
      setWebhookEndpoints((current) =>
        current.filter((item) => item.id !== deleteWebhookTarget.id)
      );
      if (selectedWebhookEndpoint?.id === deleteWebhookTarget.id) {
        setSelectedWebhookEndpoint(null);
        setWebhookDeliveries([]);
      }
      setDeleteWebhookTarget(null);
      toast.success("Webhook endpoint deleted.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to delete webhook endpoint"
      );
    } finally {
      setDeletingWebhook(false);
    }
  }

  function toggleWebhookEvent(event: OutboundWebhookEvent, checked: boolean) {
    setWebhookEvents((current) =>
      checked
        ? Array.from(new Set([...current, event]))
        : current.filter((item) => item !== event)
    );
  }

  async function loadWebhookDeliveries(endpoint: WebhookEndpoint) {
    setSelectedWebhookEndpoint(endpoint);
    setWebhookDeliveriesLoading(true);
    try {
      const deliveries = await api.listWebhookDeliveries(endpoint.id);
      setWebhookDeliveries(deliveries);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to load webhook deliveries"
      );
    } finally {
      setWebhookDeliveriesLoading(false);
    }
  }

  async function retryWebhookDelivery(delivery: WebhookDelivery) {
    setRetryingDeliveryId(delivery.id);
    try {
      const retried = await api.retryWebhookDelivery(delivery.id);
      setWebhookDeliveries((current) =>
        current.map((item) => (item.id === retried.id ? retried : item))
      );
      toast.success("Webhook delivery retry queued.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to retry webhook delivery"
      );
    } finally {
      setRetryingDeliveryId(null);
    }
  }

  function selectOrganization(organizationId: string) {
    setCurrentOrganizationId(organizationId);
    setCreatedApiKey(null);
    setCreatedWebhookSecret(null);
    const selected = organizations.find((org) => org.id === organizationId);
    toast.success(`Switched to ${selected?.name ?? "organization"}.`);
  }

  function signOut() {
    clearSessionState();
    window.location.href = "/login";
  }

  function formatDate(value?: string | null) {
    if (!value) {
      return "Never";
    }

    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  }

  function webhookStatusVariant(status: string) {
    if (status === "DELIVERED") {
      return "success" as const;
    }
    if (status === "FAILED") {
      return "destructive" as const;
    }
    if (status === "PENDING") {
      return "warning" as const;
    }
    return "secondary" as const;
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Manage your organization, account access, API keys, and webhooks."
      />
      <section className="grid gap-6 p-5 sm:p-6 lg:grid-cols-2">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Organization</CardTitle>
            <p className="text-sm leading-6 text-muted-foreground">
              Choose the workspace you are configuring or create a new one.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={createOrganization} className="space-y-4">
              <div className="space-y-2">
                <Label>Active organization</Label>
                <Select
                  value={currentOrganizationId ?? undefined}
                  onValueChange={selectOrganization}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select organization" />
                  </SelectTrigger>
                  <SelectContent>
                    {organizations.map((organization) => (
                      <SelectItem key={organization.id} value={organization.id}>
                        {organization.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label htmlFor="new-org">New organization</Label>
                <Input
                  id="new-org"
                  placeholder="Acme Inc."
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? <Spinner /> : null}
                {saving ? "Creating..." : "Create organization"}
              </Button>
            </form>
            <Separator className="my-4" />
            <form onSubmit={renameOrganization} className="space-y-2">
              <Label htmlFor="rename-org">Rename active organization</Label>
              <div className="flex gap-2">
                <Input
                  id="rename-org"
                  placeholder={
                    organizations.find((org) => org.id === currentOrganizationId)
                      ?.name ?? "Organization name"
                  }
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                />
                <Button
                  type="submit"
                  variant="outline"
                  disabled={
                    renaming || !currentOrganizationId || !renameValue.trim()
                  }
                >
                  {renaming ? <Spinner /> : null}
                  Rename
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <p className="text-sm leading-6 text-muted-foreground">
              Signed-in user and local API endpoint details.
            </p>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4 text-sm">
              <div>
                <dt className="font-medium">Email</dt>
                <dd className="mt-1 text-muted-foreground">
                  {user?.email ?? "Not signed in"}
                </dd>
              </div>
              <div>
                <dt className="font-medium">API base URL</dt>
                <dd className="mt-1 font-mono text-xs text-muted-foreground">
                  {apiBaseUrl}
                </dd>
              </div>
            </dl>
            <Separator className="my-5" />
            <Button type="button" variant="outline" onClick={signOut}>
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </CardContent>
        </Card>

        <InstanceSettingsCard />

        <Card className="h-fit lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              API keys
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {createdApiKey ? (
              <Alert variant="warning">
                <AlertTitle>Copy this key now</AlertTitle>
                <AlertDescription>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-background px-3 py-2 text-xs">
                      {createdApiKey}
                    </code>
                    <Button type="button" variant="outline" onClick={copyApiKey}>
                      <Copy className="h-4 w-4" />
                      Copy
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}

            <form onSubmit={createApiKey} className="flex flex-col gap-3 sm:flex-row">
              <div className="min-w-0 flex-1 space-y-2">
                <Label htmlFor="api-key-name">Key name</Label>
                <Input
                  id="api-key-name"
                  placeholder="Production app"
                  value={apiKeyName}
                  onChange={(event) => setApiKeyName(event.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="submit"
                  disabled={
                    creatingApiKey ||
                    !currentOrganizationId ||
                    !apiKeyName.trim()
                  }
                >
                  {creatingApiKey ? <Spinner /> : <KeyRound className="h-4 w-4" />}
                  Create key
                </Button>
              </div>
            </form>

            <Separator />

            {apiKeysLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner />
                Loading API keys
              </div>
            ) : apiKeys.length === 0 ? (
                <EmptyState
                  icon={KeyRound}
                  title="No API keys yet"
                  description="Create a named key when an app needs to send email through QQueue."
                  className="border bg-muted/20"
                />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last used</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apiKeys.map((apiKey) => (
                    <TableRow key={apiKey.id}>
                      <TableCell>
                        <div className="font-medium">{apiKey.name}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Created {formatDate(apiKey.createdAt)}
                        </div>
                      </TableCell>
                      <TableCell>
                        {apiKey.revokedAt ? (
                          <Badge variant="secondary">Revoked</Badge>
                        ) : (
                          <Badge variant="success">Active</Badge>
                        )}
                      </TableCell>
                      <TableCell>{formatDate(apiKey.lastUsedAt)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={Boolean(apiKey.revokedAt)}
                          onClick={() => setRevokeTarget(apiKey)}
                          aria-label={`Revoke ${apiKey.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

          </CardContent>
        </Card>

        <Card className="h-fit lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Webhook className="h-4 w-4" />
              Webhook endpoints
            </CardTitle>
            <p className="text-sm leading-6 text-muted-foreground">
              Send delivery events to your app as they happen.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            {createdWebhookSecret ? (
              <Alert variant="warning">
                <AlertTitle>Copy this signing secret now</AlertTitle>
                <AlertDescription>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-background px-3 py-2 text-xs">
                      {createdWebhookSecret}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={copyWebhookSecret}
                    >
                      <Copy className="h-4 w-4" />
                      Copy
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}

            <form onSubmit={createWebhookEndpoint} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="webhook-name">Endpoint name</Label>
                  <Input
                    id="webhook-name"
                    placeholder="Production webhook"
                    value={webhookName}
                    onChange={(event) => setWebhookName(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="webhook-url">Endpoint URL</Label>
                  <Input
                    id="webhook-url"
                    placeholder="https://app.example.com/webhooks/qqueue"
                    value={webhookUrl}
                    onChange={(event) => setWebhookUrl(event.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Events</Label>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {outboundWebhookEvents.map((event) => (
                    <div
                      key={event}
                      className="flex items-center justify-between gap-3 rounded-xl border bg-background/60 px-3 py-2.5 text-sm"
                    >
                      <span className="min-w-0 truncate">{event}</span>
                      <Switch
                        checked={webhookEvents.includes(event)}
                        onCheckedChange={(checked) =>
                          toggleWebhookEvent(event, checked === true)
                        }
                        aria-label={`Enable ${event}`}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <Button
                type="submit"
                disabled={
                  creatingWebhook ||
                  !currentOrganizationId ||
                  !webhookName.trim() ||
                  !webhookUrl.trim() ||
                  webhookEvents.length === 0
                }
              >
                {creatingWebhook ? <Spinner /> : null}
                Create endpoint
              </Button>
            </form>

            <Separator />

            {webhooksLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner />
                Loading webhook endpoints
              </div>
            ) : webhookEndpoints.length === 0 ? (
                <EmptyState
                  icon={Webhook}
                  title="No webhook endpoints yet"
                  description="Create an endpoint to receive delivery, bounce, and complaint events."
                  className="border bg-muted/20"
                />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead>Events</TableHead>
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {webhookEndpoints.map((endpoint) => (
                    <TableRow key={endpoint.id}>
                      <TableCell>
                        <div className="font-medium">{endpoint.name}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Created {formatDate(endpoint.createdAt)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="break-all text-xs">{endpoint.url}</code>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {endpoint.events.map((event) => (
                            <Badge key={event} variant="outline">
                              {event}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => void loadWebhookDeliveries(endpoint)}
                          aria-label={`View deliveries for ${endpoint.name}`}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteWebhookTarget(endpoint)}
                          aria-label={`Delete ${endpoint.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {selectedWebhookEndpoint ? (
              <div className="space-y-3 rounded-md border p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-medium">
                      Recent deliveries for {selectedWebhookEndpoint.name}
                    </h3>
                    <p className="mt-1 break-all text-xs text-muted-foreground">
                      {selectedWebhookEndpoint.url}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={webhookDeliveriesLoading}
                    onClick={() =>
                      void loadWebhookDeliveries(selectedWebhookEndpoint)
                    }
                  >
                    {webhookDeliveriesLoading ? (
                      <Spinner />
                    ) : (
                      <RotateCcw className="h-4 w-4" />
                    )}
                    Refresh
                  </Button>
                </div>

                {webhookDeliveriesLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner />
                    Loading webhook deliveries
                  </div>
                ) : webhookDeliveries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No delivery attempts for this endpoint yet.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Event</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Response</TableHead>
                        <TableHead>Retry state</TableHead>
                        <TableHead className="w-16" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {webhookDeliveries.map((delivery) => (
                        <TableRow key={delivery.id}>
                          <TableCell>
                            <div className="font-medium">
                              {delivery.eventName}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              Created {formatDate(delivery.createdAt)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={webhookStatusVariant(delivery.status)}
                            >
                              {delivery.status}
                            </Badge>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {delivery.deliveredAt
                                ? `Delivered ${formatDate(delivery.deliveredAt)}`
                                : `${delivery.attempts} attempt${
                                    delivery.attempts === 1 ? "" : "s"
                                  }`}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              {delivery.responseStatus ?? "No response"}
                            </div>
                            {delivery.error ? (
                              <div className="mt-1 max-w-sm break-words text-xs text-destructive">
                                {delivery.error}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              {delivery.nextAttemptAt
                                ? `Next ${formatDate(delivery.nextAttemptAt)}`
                                : "No retry scheduled"}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={
                                delivery.status === "DELIVERED" ||
                                retryingDeliveryId === delivery.id
                              }
                              onClick={() => void retryWebhookDelivery(delivery)}
                              aria-label={`Retry ${delivery.eventName} delivery`}
                            >
                              {retryingDeliveryId === delivery.id ? (
                                <Spinner />
                              ) : (
                                <RotateCcw className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <AlertDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setRevokeTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API key?</AlertDialogTitle>
            <AlertDialogDescription>
              Applications using "{revokeTarget?.name}" will stop being able to
              send transactional email immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={revoking}
              onClick={(event) => {
                event.preventDefault();
                void revokeApiKey();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {revoking ? <Spinner /> : null}
              Revoke key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(deleteWebhookTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteWebhookTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete webhook endpoint?</AlertDialogTitle>
            <AlertDialogDescription>
              QQueue will stop sending events to "{deleteWebhookTarget?.name}".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingWebhook}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingWebhook}
              onClick={(event) => {
                event.preventDefault();
                void deleteWebhookEndpoint();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingWebhook ? <Spinner /> : null}
              Delete endpoint
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
