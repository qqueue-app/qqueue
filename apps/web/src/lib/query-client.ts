import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage } from "./use-api.js";

/**
 * A 4xx will not fix itself: a 401 means the session is gone (the api client
 * already clears it and the route guard bounces to /login), and a 403 or 404
 * means this request is simply not allowed. Only retry the 5xx and network
 * failures that a second attempt could actually resolve.
 *
 * Reads `status` off the error by shape rather than `instanceof ApiError`, so
 * an error that crossed a module boundary still short-circuits correctly.
 */
function shouldRetry(failureCount: number, error: unknown) {
  const status =
    typeof error === "object" && error !== null
      ? (error as { status?: unknown }).status
      : undefined;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return false;
  }
  return failureCount < 2;
}

export function createQueryClient() {
  return new QueryClient({
    /**
     * Tell people when a page fails to load its data.
     *
     * Only when there is nothing to fall back on: a background refetch that
     * fails while the screen still shows good data is not worth interrupting
     * anyone over, but a first load that fails leaves an empty page that would
     * otherwise be indistinguishable from "you have no contacts". Queries can
     * opt out with `meta: { silent: true }` — the unread badge does, since a
     * failed count is decoration, not content.
     */
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.meta?.silent) return;
        if (query.state.data !== undefined) return;
        toast.error(errorMessage(error, "Couldn't load this page's data."));
      },
    }),
    defaultOptions: {
      queries: {
        // Mail data goes stale quickly; 30s keeps navigation instant without
        // showing yesterday's inbox.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        refetchOnWindowFocus: true,
        // The app is installable — coming back from the lock screen should
        // reconcile, and an offline PWA should not spin forever.
        networkMode: "online",
      },
      mutations: {
        retry: false,
        networkMode: "online",
      },
    },
  });
}

/**
 * Query key factory. Every key starts with its resource name and carries the
 * organization id, so switching organizations swaps caches instead of leaking
 * one org's rows into another's view.
 */
export const qk = {
  dashboard: (orgId: string) => ["dashboard", orgId] as const,

  smtpConnections: (orgId: string) => ["smtp-connections", orgId] as const,
  sendableSmtpConnections: (orgId: string) =>
    ["smtp-connections", orgId, "sendable"] as const,
  connectionGrants: (connectionId: string) =>
    ["connection-grants", connectionId] as const,

  mailcowStatus: (orgId: string) => ["mailcow-status", orgId] as const,
  mailboxes: (orgId: string) => ["mailboxes", orgId] as const,

  contacts: (orgId: string) => ["contacts", orgId] as const,
  contactActivity: (contactId: string) =>
    ["contact-activity", contactId] as const,
  contactLists: (orgId: string) => ["contact-lists", orgId] as const,
  segments: (orgId: string) => ["segments", orgId] as const,

  templates: (orgId: string) => ["templates", orgId] as const,
  template: (id: string) => ["template", id] as const,

  campaigns: (orgId: string) => ["campaigns", orgId] as const,
  campaignAnalytics: (id: string) => ["campaign-analytics", id] as const,
  recurringSends: (orgId: string) => ["recurring-sends", orgId] as const,

  drafts: (orgId: string) => ["email-drafts", orgId] as const,
  draft: (id: string) => ["email-draft", id] as const,
  outbox: (orgId: string) => ["outbox", orgId] as const,
  // The sent archive filters and pages on the server, so the filters are part
  // of the key: each combination is its own cached page.
  sent: (orgId: string, filters?: Record<string, unknown>) =>
    ["sent", orgId, filters ?? {}] as const,

  inboxAccounts: (orgId: string) => ["inbox-accounts", orgId] as const,
  inboundMessages: (orgId: string, filters?: Record<string, unknown>) =>
    ["inbound-messages", orgId, filters ?? {}] as const,
  inboxUnreadCount: (orgId: string) => ["inbox-unread", orgId] as const,

  suppressions: (orgId: string) => ["suppressions", orgId] as const,
  suppressionPolicy: (orgId: string) => ["suppression-policy", orgId] as const,
  domainThrottles: (orgId: string) => ["domain-throttles", orgId] as const,

  deliverabilityOverview: (orgId: string) =>
    ["deliverability", orgId, "overview"] as const,
  deliverabilityDomains: (orgId: string) =>
    ["deliverability", orgId, "domains"] as const,
  deliverabilityAlerts: (orgId: string) =>
    ["deliverability", orgId, "alerts"] as const,

  members: (orgId: string) => ["members", orgId] as const,
  invites: (orgId: string) => ["invites", orgId] as const,
  organizations: () => ["organizations"] as const,

  apiKeys: (orgId: string) => ["api-keys", orgId] as const,
  webhookEndpoints: (orgId: string) => ["webhook-endpoints", orgId] as const,
  webhookDeliveries: (endpointId: string) =>
    ["webhook-deliveries", endpointId] as const,

  queueOperations: (orgId: string) => ["queue-operations", orgId] as const,
  recipientSuggestions: (orgId: string) =>
    ["recipient-suggestions", orgId] as const,

  /** The signed-in user as the server sees them, incl. isInstanceAdmin. */
  me: () => ["me"] as const,

  instanceSettings: () => ["instance-settings"] as const,
  instanceEnvStatus: () => ["instance-env-status"] as const,

  // Install-scope administration. No org id in any of these keys — that is the
  // point: they are not org-scoped, so they must not be cached per-org.
  instanceOrganizations: () => ["instance-organizations"] as const,
  instanceOrganization: (id: string) => ["instance-organization", id] as const,
  instanceMailDomains: () => ["instance-mail-domains"] as const,
  instanceMailDomainDns: (domain: string) =>
    ["instance-mail-domain-dns", domain] as const,
  instanceMailboxes: () => ["instance-mailboxes"] as const,
  instanceMailDomainGrants: (orgId?: string) =>
    ["instance-mail-domain-grants", orgId ?? "all"] as const,
  instanceMutes: () => ["instance-mutes"] as const,

  pushPublicKey: () => ["push-public-key"] as const,
} as const;
