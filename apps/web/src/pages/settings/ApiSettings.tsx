import { FormEvent, useEffect, useState } from "react";
import { KeyRound, RotateCcw, Trash2, Webhook } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../../components/PageHeader.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { EmptyState } from "../../components/EmptyState.js";
import { CopyableSecret } from "../../components/settings/CopyableSecret.js";
import {
  Field,
  FormColumn,
  FormSection,
  FormSections,
} from "../../components/settings/FormColumn.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { FieldHint, Label } from "../../components/ui/label.js";
import { RowActions } from "../../components/ui/row-actions.js";
import { Spinner } from "../../components/ui/spinner.js";
import { SettingsRow, Switch } from "../../components/ui/switch.js";
import { formatFullDate } from "../../lib/format.js";
import {
  api,
  outboundWebhookEvents,
  type ApiKey,
  type OutboundWebhookEvent,
  type WebhookDelivery,
  type WebhookEndpoint,
} from "../../lib/api.js";
import { useSession } from "../../lib/session-context.js";

/**
 * What each event actually means, in the words of someone deciding whether to
 * subscribe to it. The event name alone ("email.complained") is a wire format,
 * not an explanation — and a bare grid of them was the old page's least
 * legible control.
 */
const eventDescriptions: Record<OutboundWebhookEvent, string> = {
  "email.queued": "Accepted by QQueue and waiting for a worker.",
  "email.sent": "Handed to the receiving mail server without a rejection.",
  "email.delivered": "Confirmed delivered, where the provider tells us so.",
  "email.opened": "The recipient loaded the tracking pixel.",
  "email.clicked": "The recipient followed a tracked link.",
  "email.bounced": "Rejected — hard, soft, or blocked.",
  "email.complained": "Marked as spam by the recipient.",
  "email.failed": "Gave up after exhausting retries.",
};

function deliveryBadgeVariant(status: string) {
  if (status === "DELIVERED") return "ok" as const;
  if (status === "FAILED") return "err" as const;
  if (status === "PENDING") return "warn" as const;
  return "neutral" as const;
}

/**
 * API keys and webhooks on one page, because they have one audience: whoever is
 * wiring QQueue into an application. Keys are how their code sends; webhooks
 * are how it hears back. Splitting them would make a developer visit two pages
 * to finish one integration.
 */
export function ApiSettings() {
  const { currentOrganizationId } = useSession();

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
    "email.bounced",
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

  async function createApiKey(event: FormEvent) {
    event.preventDefault();
    if (!currentOrganizationId) {
      return;
    }

    setCreatingApiKey(true);
    try {
      const result = await api.createApiKey({
        organizationId: currentOrganizationId,
        name: apiKeyName,
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
        events: webhookEvents,
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

  return (
    <>
      <PageHeader
        title="API"
        description="Keys for sending from your own code, and webhooks for hearing back."
        breadcrumb={{ label: "Settings", to: "/settings" }}
      />

      <FormColumn>
        <FormSections>
          {/* ------------------------------------------------------- keys */}
          <FormSection
            title="API keys"
            description="One named key per application, so you can revoke a single integration without breaking the rest."
          >
            {createdApiKey ? (
              <CopyableSecret
                title="Copy this key now"
                description="It is shown once. If you lose it, revoke the key and create another."
                value={createdApiKey}
                copiedMessage="API key copied."
                failureMessage="Unable to copy API key."
              />
            ) : null}

            <form
              onSubmit={createApiKey}
              className="flex flex-col gap-3 xs:flex-row xs:items-end"
            >
              <Field>
                <Label htmlFor="api-key-name">Key name</Label>
                <Input
                  id="api-key-name"
                  width="name"
                  placeholder="Production app"
                  value={apiKeyName}
                  onChange={(event) => setApiKeyName(event.target.value)}
                />
              </Field>
              {/*
                The page's one primary button (§3). Creating a webhook below is
                deliberately secondary: two accent buttons on one page is two
                answers to "what am I meant to do here?".
              */}
              <Button
                type="submit"
                disabled={
                  creatingApiKey || !currentOrganizationId || !apiKeyName.trim()
                }
              >
                {creatingApiKey ? <Spinner /> : <KeyRound className="h-4 w-4" />}
                Create key
              </Button>
            </form>

            {apiKeysLoading ? (
              <div className="flex items-center gap-2 text-ui text-text-secondary">
                <Spinner />
                Loading API keys
              </div>
            ) : apiKeys.length === 0 ? (
              <EmptyState
                icon={KeyRound}
                title="No API keys yet"
                description="Create a named key when an app needs to send email through QQueue."
              />
            ) : (
              <ul className="border-t border-border">
                {apiKeys.map((apiKey) => (
                  <li
                    key={apiKey.id}
                    className="flex min-h-touch items-center gap-3 border-b border-border py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-body font-medium text-text">
                        {apiKey.name}
                      </div>
                      <div
                        data-numeric
                        className="text-meta text-text-tertiary"
                      >
                        Created {formatFullDate(apiKey.createdAt)} · Last used{" "}
                        {formatFullDate(apiKey.lastUsedAt)}
                      </div>
                    </div>
                    <Badge variant={apiKey.revokedAt ? "neutral" : "ok"}>
                      {apiKey.revokedAt ? "Revoked" : "Active"}
                    </Badge>
                    <RowActions
                      rowLabel={apiKey.name}
                      className="shrink-0"
                      actions={[
                        {
                          label: `Revoke ${apiKey.name}`,
                          icon: Trash2,
                          primary: true,
                          destructive: true,
                          disabled: Boolean(apiKey.revokedAt),
                          onSelect: () => setRevokeTarget(apiKey),
                        },
                      ]}
                    />
                  </li>
                ))}
              </ul>
            )}
          </FormSection>

          {/* --------------------------------------------------- webhooks */}
          <FormSection
            title="Webhook endpoints"
            description="Send delivery events to your app as they happen. Each endpoint gets its own signing secret."
          >
            {createdWebhookSecret ? (
              <CopyableSecret
                title="Copy this signing secret now"
                description="Use it to verify the signature on every request QQueue sends to this endpoint."
                value={createdWebhookSecret}
                copiedMessage="Webhook signing secret copied."
                failureMessage="Unable to copy webhook signing secret."
              />
            ) : null}

            <form onSubmit={createWebhookEndpoint} className="space-y-5">
              <Field>
                <Label htmlFor="webhook-name">Endpoint name</Label>
                <Input
                  id="webhook-name"
                  width="name"
                  placeholder="Production webhook"
                  value={webhookName}
                  onChange={(event) => setWebhookName(event.target.value)}
                />
              </Field>

              <Field>
                <Label htmlFor="webhook-url">Endpoint URL</Label>
                <Input
                  id="webhook-url"
                  type="url"
                  inputMode="url"
                  width="long"
                  placeholder="https://app.example.com/webhooks/qqueue"
                  value={webhookUrl}
                  onChange={(event) => setWebhookUrl(event.target.value)}
                />
                <FieldHint>Must accept POST and answer within 10 seconds.</FieldHint>
              </Field>

              {/*
                Events as settings rows (§3), not the grid of bordered toggle
                boxes this used to be. A border around every option makes a list
                of choices look like a list of warnings, and eight of them in a
                four-column grid left no room to say what any of them meant.
              */}
              <div>
                <div className="text-ui font-medium text-text">Events</div>
                <div className="mt-2 border-t border-border">
                  {outboundWebhookEvents.map((event) => (
                    <SettingsRow
                      key={event}
                      label={event}
                      description={eventDescriptions[event]}
                      htmlFor={`webhook-event-${event}`}
                    >
                      <Switch
                        id={`webhook-event-${event}`}
                        checked={webhookEvents.includes(event)}
                        onCheckedChange={(checked) =>
                          toggleWebhookEvent(event, checked === true)
                        }
                        aria-label={`Enable ${event}`}
                      />
                    </SettingsRow>
                  ))}
                </div>
              </div>

              <Button
                type="submit"
                variant="secondary"
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

            {webhooksLoading ? (
              <div className="flex items-center gap-2 text-ui text-text-secondary">
                <Spinner />
                Loading webhook endpoints
              </div>
            ) : webhookEndpoints.length === 0 ? (
              <EmptyState
                icon={Webhook}
                title="No webhook endpoints yet"
                description="Create an endpoint to receive delivery, bounce, and complaint events."
              />
            ) : (
              <ul className="border-t border-border">
                {webhookEndpoints.map((endpoint) => (
                  <li
                    key={endpoint.id}
                    className="flex min-h-touch items-start gap-3 border-b border-border py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-body font-medium text-text">
                        {endpoint.name}
                      </div>
                      <div className="break-all text-ui text-text-secondary">
                        {endpoint.url}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {endpoint.events.map((event) => (
                          <Badge key={event} variant="outline">
                            {event}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <RowActions
                      rowLabel={endpoint.name}
                      className="shrink-0"
                      actions={[
                        {
                          label: `View deliveries for ${endpoint.name}`,
                          icon: RotateCcw,
                          primary: true,
                          onSelect: () => void loadWebhookDeliveries(endpoint),
                        },
                        {
                          label: `Delete ${endpoint.name}`,
                          icon: Trash2,
                          destructive: true,
                          onSelect: () => setDeleteWebhookTarget(endpoint),
                        },
                      ]}
                    />
                  </li>
                ))}
              </ul>
            )}
          </FormSection>

          {/* ------------------------------------------------- deliveries */}
          {selectedWebhookEndpoint ? (
            <FormSection
              title={`Recent deliveries · ${selectedWebhookEndpoint.name}`}
              description={selectedWebhookEndpoint.url}
              action={
                <Button
                  type="button"
                  variant="secondary"
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
              }
            >
              {webhookDeliveriesLoading ? (
                <div className="flex items-center gap-2 text-ui text-text-secondary">
                  <Spinner />
                  Loading webhook deliveries
                </div>
              ) : webhookDeliveries.length === 0 ? (
                <EmptyState
                  icon={Webhook}
                  title="No delivery attempts yet"
                  description="Attempts appear here as soon as this endpoint's events fire."
                />
              ) : (
                /*
                  Deliveries were a five-column table, which is three columns
                  more than a phone can hold. As stacked rows the same five
                  facts read top-to-bottom at 375px and left-to-right at 1280px,
                  with no horizontal scroll at any width in between (§5).
                */
                <ul className="border-t border-border">
                  {webhookDeliveries.map((delivery) => (
                    <li
                      key={delivery.id}
                      className="flex items-start gap-3 border-b border-border py-3"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-body font-medium text-text">
                            {delivery.eventName}
                          </span>
                          <Badge variant={deliveryBadgeVariant(delivery.status)}>
                            {delivery.status}
                          </Badge>
                        </div>
                        <div data-numeric className="text-meta text-text-tertiary">
                          {delivery.deliveredAt
                            ? `Delivered ${formatFullDate(delivery.deliveredAt)}`
                            : `${delivery.attempts} attempt${
                                delivery.attempts === 1 ? "" : "s"
                              }`}
                          {" · "}
                          {delivery.responseStatus
                            ? `HTTP ${delivery.responseStatus}`
                            : "No response"}
                          {" · "}
                          {delivery.nextAttemptAt
                            ? `Next ${formatFullDate(delivery.nextAttemptAt)}`
                            : "No retry scheduled"}
                        </div>
                        {delivery.error ? (
                          <p className="break-words text-meta text-err">
                            {delivery.error}
                          </p>
                        ) : null}
                      </div>
                      <RowActions
                        rowLabel={`${delivery.eventName} delivery`}
                        className="shrink-0"
                        actions={[
                          {
                            label: `Retry ${delivery.eventName} delivery`,
                            icon: RotateCcw,
                            primary: true,
                            disabled:
                              delivery.status === "DELIVERED" ||
                              retryingDeliveryId === delivery.id,
                            onSelect: () => void retryWebhookDelivery(delivery),
                          },
                        ]}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </FormSection>
          ) : null}
        </FormSections>
      </FormColumn>

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title="Revoke API key?"
        description={`Applications using "${revokeTarget?.name}" will stop being able to send transactional email immediately.`}
        confirmLabel="Revoke key"
        loading={revoking}
        onConfirm={() => void revokeApiKey()}
      />

      <ConfirmDialog
        open={deleteWebhookTarget !== null}
        onOpenChange={(open) => !open && setDeleteWebhookTarget(null)}
        title="Delete webhook endpoint?"
        description={`QQueue will stop sending events to "${deleteWebhookTarget?.name}".`}
        confirmLabel="Delete endpoint"
        loading={deletingWebhook}
        onConfirm={() => void deleteWebhookEndpoint()}
      />
    </>
  );
}
