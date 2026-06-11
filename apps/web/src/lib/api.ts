import { clearSession, getSession, updateTokens } from "./session.js";

const apiBaseUrl =
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") ??
  (import.meta.env.PROD ? "" : "http://localhost:4000");

export interface ApiEnvelope<T> {
  data: T;
}

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
}

export interface Contact {
  id: string;
  organizationId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  status: string;
}

export interface ContactList {
  id: string;
  organizationId: string;
  name: string;
  contacts?: Contact[];
  _count?: { contacts: number; campaigns: number };
}

export interface Template {
  id: string;
  organizationId: string;
  name: string;
  subject: string;
  html: string;
  text?: string | null;
}

export interface SMTPConnection {
  id: string;
  organizationId: string;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  fromEmail: string;
  fromName?: string | null;
  isDefault: boolean;
}

export interface ApiKey {
  id: string;
  organizationId: string;
  userId?: string | null;
  name: string;
  lastUsedAt?: string | null;
  createdAt: string;
  revokedAt?: string | null;
}

export const outboundWebhookEvents = [
  "email.queued",
  "email.sent",
  "email.delivered",
  "email.opened",
  "email.clicked",
  "email.bounced",
  "email.complained",
  "email.failed"
] as const;

export type OutboundWebhookEvent = (typeof outboundWebhookEvents)[number];

export interface WebhookEndpoint {
  id: string;
  organizationId: string;
  name: string;
  url: string;
  events: OutboundWebhookEvent[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface WebhookDelivery {
  id: string;
  organizationId: string;
  endpointId: string;
  emailEventId: string;
  eventName: string;
  status: string;
  attempts: number;
  responseStatus?: number | null;
  error?: string | null;
  nextAttemptAt?: string | null;
  deliveredAt?: string | null;
  createdAt: string;
}

export interface QueueJob {
  id: string;
  name: string;
  queueName: string;
  data: Record<string, unknown>;
  attemptsMade: number;
  attempts: number;
  timestamp: string;
  processedOn?: string | null;
  finishedOn?: string | null;
  failedReason?: string | null;
}

export interface QueueOperationsSummary {
  name: string;
  counts: {
    queued: number;
    processing: number;
    failed: number;
    completed: number;
  };
  queuedJobs: QueueJob[];
  processingJobs: QueueJob[];
  failedJobs: QueueJob[];
}

export interface Campaign {
  id: string;
  organizationId: string;
  name: string;
  status: string;
  scheduledAt?: string | null;
  cronExpression?: string | null;
  timezone?: string | null;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  templateId?: string | null;
  contactListId?: string | null;
  template?: { id: string; name: string; subject: string } | null;
  contactList?: {
    id: string;
    name: string;
    _count?: { contacts: number };
  } | null;
  _count?: { emailJobs: number };
}

export interface DashboardSummary {
  counts: {
    smtpConnections: number;
    contacts: number;
    templates: number;
    emailsToday: number;
    failedToday: number;
    processingEmails: number;
  };
  setup: {
    hasSmtpConnection: boolean;
    hasDefaultSmtp: boolean;
    hasContacts: boolean;
    hasTemplates: boolean;
  };
  defaultSmtpConnection?: {
    id: string;
    name: string;
    host: string;
    fromEmail: string;
  } | null;
  recentEmailJobs: Array<{
    id: string;
    toEmail: string;
    subject: string;
    status: string;
    smtpConnectionName?: string | null;
    createdAt: string;
    sentAt?: string | null;
  }>;
  recentEvents: Array<{
    id: string;
    type: string;
    occurredAt: string;
    emailJob: {
      toEmail: string;
      subject: string;
    };
  }>;
}

export interface CampaignAnalytics {
  campaign: { id: string; name: string; status: string };
  totals: {
    recipients: number;
    sent: number;
    failed: number;
    delivered: number;
    opened: number;
    uniqueOpened: number;
    clicked: number;
    uniqueClicked: number;
    bounced: number;
    complained: number;
  };
  rates: { open: number; click: number; bounce: number };
  links: Array<{ url: string; clicks: number }>;
  recentEvents: Array<{
    id: string;
    type: string;
    occurredAt: string;
    toEmail: string;
  }>;
}

interface ApiErrorIssue {
  path?: (string | number)[];
  message?: string;
}

interface ApiErrorBody {
  error?: { message?: string; issues?: ApiErrorIssue[] };
}

export class ApiError extends Error {
  status: number;
  issues?: ApiErrorIssue[];

  constructor(message: string, status: number, issues?: ApiErrorIssue[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.issues = issues;
  }
}

function buildErrorMessage(status: number, body: ApiErrorBody | null) {
  const error = body?.error;

  // Zod validation errors come back generic; surface the field-level issues.
  if (error?.issues?.length) {
    const detail = error.issues
      .map((issue) => {
        const field = issue.path?.filter((part) => part !== "").join(".");
        return field ? `${field}: ${issue.message}` : issue.message;
      })
      .filter(Boolean)
      .join("; ");
    if (detail) {
      return detail;
    }
  }

  if (error?.message) {
    return error.message;
  }

  if (status === 0) {
    return "Cannot reach the API. Is the server running?";
  }

  return `Request failed (${status})`;
}

const AUTH_PREFIX = "/api/v1/auth/";

// Exchange the stored refresh token for a fresh pair. Returns true on success.
async function refreshTokens(): Promise<boolean> {
  const { refreshToken } = getSession();
  if (!refreshToken) {
    return false;
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken })
    });
    if (!response.ok) {
      return false;
    }
    const body = (await response.json().catch(() => null)) as {
      data?: { tokens?: { accessToken: string; refreshToken: string } };
    } | null;
    const tokens = body?.data?.tokens;
    if (!tokens?.accessToken) {
      return false;
    }
    updateTokens(tokens);
    return true;
  } catch {
    return false;
  }
}

function redirectToLogin() {
  clearSession();
  if (
    typeof window !== "undefined" &&
    window.location.pathname !== "/login" &&
    window.location.pathname !== "/register"
  ) {
    window.location.href = "/login";
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  retryOnUnauthorized = true
): Promise<T> {
  const { accessToken } = getSession();
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...options.headers
      }
    });
  } catch {
    throw new ApiError("Cannot reach the API. Is the server running?", 0);
  }

  // Access tokens are short-lived: on a 401, try a one-time refresh + retry
  // before giving up and bouncing the user to the login screen.
  if (
    response.status === 401 &&
    retryOnUnauthorized &&
    !path.startsWith(AUTH_PREFIX)
  ) {
    if (await refreshTokens()) {
      return request<T>(path, options, false);
    }
    redirectToLogin();
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const body = (await response.json().catch(() => null)) as
    | ApiEnvelope<T>
    | ApiErrorBody
    | null;

  if (!response.ok) {
    const errorBody = body as ApiErrorBody | null;
    throw new ApiError(
      buildErrorMessage(response.status, errorBody),
      response.status,
      errorBody?.error?.issues
    );
  }

  return (body as ApiEnvelope<T>).data;
}

export const api = {
  dashboardSummary(organizationId: string) {
    return request<DashboardSummary>(
      `/api/v1/dashboard/summary?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  register(input: {
    email: string;
    password: string;
    name?: string;
    organizationName?: string;
  }) {
    return request<{
      user: { id: string; email: string; name?: string | null };
      organization: Organization;
      tokens: { accessToken: string; refreshToken: string };
    }>("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  login(input: { email: string; password: string }) {
    return request<{
      user: { id: string; email: string; name?: string | null };
      organizations: Array<{ id: string; name: string; role: string }>;
      tokens: { accessToken: string; refreshToken: string };
    }>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  requestPasswordReset(input: { email: string }) {
    return request<{ message: string; resetToken?: string }>(
      "/api/v1/auth/password-reset/request",
      {
        method: "POST",
        body: JSON.stringify(input)
      }
    );
  },

  resetPassword(input: { token: string; password: string }) {
    return request<{ message: string }>(
      "/api/v1/auth/password-reset/confirm",
      {
        method: "POST",
        body: JSON.stringify(input)
      }
    );
  },

  listOrganizations() {
    return request<Organization[]>("/api/v1/organizations");
  },

  createOrganization(input: { name: string }) {
    return request<Organization>("/api/v1/organizations", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  listSMTPConnections(organizationId: string) {
    return request<SMTPConnection[]>(
      `/api/v1/smtp-connections?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  createSMTPConnection(input: Record<string, unknown>) {
    return request<SMTPConnection>("/api/v1/smtp-connections", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  updateSMTPConnection(id: string, input: Record<string, unknown>) {
    return request<SMTPConnection>(`/api/v1/smtp-connections/${id}`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
  },

  deleteSMTPConnection(id: string) {
    return request<void>(`/api/v1/smtp-connections/${id}`, { method: "DELETE" });
  },

  listContacts(organizationId: string) {
    return request<Contact[]>(
      `/api/v1/contacts?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  createContact(input: Record<string, unknown>) {
    return request<Contact>("/api/v1/contacts", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  updateContact(id: string, input: Record<string, unknown>) {
    return request<Contact>(`/api/v1/contacts/${id}`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
  },

  deleteContact(id: string) {
    return request<void>(`/api/v1/contacts/${id}`, { method: "DELETE" });
  },

  listContactLists(organizationId: string) {
    return request<ContactList[]>(
      `/api/v1/contact-lists?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  createContactList(input: Record<string, unknown>) {
    return request<ContactList>("/api/v1/contact-lists", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  updateContactList(id: string, input: Record<string, unknown>) {
    return request<ContactList>(`/api/v1/contact-lists/${id}`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
  },

  deleteContactList(id: string) {
    return request<void>(`/api/v1/contact-lists/${id}`, { method: "DELETE" });
  },

  listTemplates(organizationId: string) {
    return request<Template[]>(
      `/api/v1/templates?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  createTemplate(input: Record<string, unknown>) {
    return request<Template>("/api/v1/templates", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  updateTemplate(id: string, input: Record<string, unknown>) {
    return request<Template>(`/api/v1/templates/${id}`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
  },

  deleteTemplate(id: string) {
    return request<void>(`/api/v1/templates/${id}`, { method: "DELETE" });
  },

  listCampaigns(organizationId: string) {
    return request<Campaign[]>(
      `/api/v1/campaigns?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  campaignAnalytics(id: string) {
    return request<CampaignAnalytics>(`/api/v1/campaigns/${id}/analytics`);
  },

  createCampaign(input: Record<string, unknown>) {
    return request<Campaign>("/api/v1/campaigns", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  updateCampaign(id: string, input: Record<string, unknown>) {
    return request<Campaign>(`/api/v1/campaigns/${id}`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
  },

  duplicateCampaign(id: string) {
    return request<Campaign>(`/api/v1/campaigns/${id}/duplicate`, {
      method: "POST"
    });
  },

  deleteCampaign(id: string) {
    return request<void>(`/api/v1/campaigns/${id}`, { method: "DELETE" });
  },

  sendCampaignNow(id: string) {
    return request<Campaign>(`/api/v1/campaigns/${id}/send`, {
      method: "POST"
    });
  },

  scheduleCampaign(id: string, scheduledAt: string) {
    return request<Campaign>(`/api/v1/campaigns/${id}/schedule`, {
      method: "POST",
      body: JSON.stringify({ scheduledAt })
    });
  },

  setCampaignRecurrence(
    id: string,
    input: { cronExpression: string; timezone: string }
  ) {
    return request<Campaign>(`/api/v1/campaigns/${id}/recurrence`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  pauseCampaign(id: string) {
    return request<Campaign>(`/api/v1/campaigns/${id}/pause`, {
      method: "POST"
    });
  },

  resumeCampaign(id: string) {
    return request<Campaign>(`/api/v1/campaigns/${id}/resume`, {
      method: "POST"
    });
  },

  sendEmail(input: Record<string, unknown>) {
    return request<{ id: string; status: string }>(
      "/api/v1/transactional-email/send",
      {
        method: "POST",
        body: JSON.stringify(input)
      }
    );
  },

  listApiKeys(organizationId: string) {
    return request<ApiKey[]>(
      `/api/v1/api-keys?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  createApiKey(input: { organizationId: string; name: string }) {
    return request<{ apiKey: ApiKey; key: string }>("/api/v1/api-keys", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  revokeApiKey(id: string) {
    return request<ApiKey>(`/api/v1/api-keys/${id}/revoke`, {
      method: "POST"
    });
  },

  listWebhookEndpoints(organizationId: string) {
    return request<WebhookEndpoint[]>(
      `/api/v1/webhook-endpoints?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  createWebhookEndpoint(input: {
    organizationId: string;
    name: string;
    url: string;
    events: OutboundWebhookEvent[];
    enabled?: boolean;
  }) {
    return request<{ endpoint: WebhookEndpoint; secret: string }>(
      "/api/v1/webhook-endpoints",
      {
        method: "POST",
        body: JSON.stringify(input)
      }
    );
  },

  deleteWebhookEndpoint(id: string) {
    return request<void>(`/api/v1/webhook-endpoints/${id}`, {
      method: "DELETE"
    });
  },

  listWebhookDeliveries(endpointId: string) {
    return request<WebhookDelivery[]>(
      `/api/v1/webhook-endpoints/${endpointId}/deliveries`
    );
  },

  retryWebhookDelivery(deliveryId: string) {
    return request<WebhookDelivery>(
      `/api/v1/webhook-endpoints/deliveries/${deliveryId}/retry`,
      {
        method: "POST"
      }
    );
  },

  queueOperations(organizationId: string) {
    return request<QueueOperationsSummary[]>(
      `/api/v1/queue-operations?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  retryQueueJob(queueName: string, jobId: string, organizationId: string) {
    return request<QueueJob>(
      `/api/v1/queue-operations/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}/retry`,
      {
        method: "POST",
        body: JSON.stringify({ organizationId })
      }
    );
  }
};
