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

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: string;
  user: {
    id: string;
    email: string;
    name?: string | null;
  };
}

export interface Contact {
  id: string;
  organizationId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  status: string;
  tags?: string[];
  createdAt?: string;
}

export interface ContactList {
  id: string;
  organizationId: string;
  name: string;
  description?: string | null;
  contacts?: Contact[];
  createdAt?: string;
  _count?: { contacts: number; campaigns: number };
}

export interface ContactImportSummary {
  created: number;
  updated: number;
  skipped: number;
  suppressed: number;
  errors: { row: number; message: string }[];
}

export interface ContactActivityEvent {
  id: string;
  type: string;
  occurredAt: string;
  emailJobId: string;
  subject?: string | null;
  origin?: string | null;
  campaignName?: string | null;
  url?: string;
}

export interface ContactActivity {
  events: ContactActivityEvent[];
  nextCursor: string | null;
}

export interface Suppression {
  id: string;
  organizationId: string;
  email: string;
  reason: string;
  source?: string | null;
  createdAt: string;
}

export interface SegmentPreview {
  count: number;
  sample: Contact[];
}

export interface SuppressionPolicy {
  organizationId: string;
  softBounceThreshold: number;
  softBounceWindowDays: number;
}

export interface DomainThrottle {
  id: string;
  organizationId: string;
  domain: string;
  maxPerMinute: number;
}

export interface DomainThrottleList {
  throttles: DomainThrottle[];
  defaultPerMinute: number;
}

export interface InboxAccount {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  host: string;
  port: number;
  secure: boolean;
  mailbox: string;
  status: "ACTIVE" | "DISABLED";
  lastSyncedAt?: string | null;
  lastSeenUid?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface InboundMessage {
  id: string;
  organizationId: string;
  inboxAccountId: string;
  emailJobId?: string | null;
  messageId: string;
  inReplyTo?: string | null;
  references: string[];
  fromEmail: string;
  fromName?: string | null;
  to: string[];
  cc: string[];
  subject: string;
  text?: string | null;
  html?: string | null;
  receivedAt: string;
  readAt?: string | null;
  imapUid?: number | null;
  emailJob?: {
    id: string;
    subject: string;
    toEmail: string;
    messageId?: string | null;
  } | null;
}

export interface InboundMessageList {
  data: InboundMessage[];
  nextCursor?: string | null;
}

export interface Segment {
  id: string;
  organizationId: string;
  name: string;
  description?: string | null;
  rules: unknown;
  createdAt?: string;
}

export interface DeliverabilityOverview {
  window: { from: string; to: string };
  totals: {
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
    hardBounced: number;
    softBounced: number;
    complained: number;
    suppressed: number;
  };
  rates: {
    delivery: number;
    bounce: number;
    complaint: number;
    open: number;
    click: number;
  };
}

export interface DeliverabilityDomains {
  truncated: boolean;
  domains: Array<{
    domain: string;
    sent: number;
    delivered: number;
    bounced: number;
    complained: number;
    bounceRate: number;
    complaintRate: number;
  }>;
}

export interface DeliverabilityAlerts {
  alerts: Array<{
    level: "warning" | "critical";
    metric: string;
    value: number;
    threshold: number;
    message: string;
  }>;
}

export interface Template {
  id: string;
  organizationId: string;
  name: string;
  subject: string;
  html: string;
  mjml?: string | null;
  text?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface EmailAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface EmailDraft {
  id: string;
  organizationId: string;
  createdByUserId: string;
  subject: string;
  html?: string | null;
  text?: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  contactIds: string[];
  listIds: string[];
  replyTo?: string | null;
  smtpConnectionId?: string | null;
  templateId?: string | null;
  variables?: Record<string, unknown>;
  attachments?: EmailAttachment[];
  createdAt: string;
  updatedAt: string;
}

export type RecipientDeliveryStatus =
  | "delivered"
  | "rejected"
  | "pending"
  | "failed";

export interface RecipientDelivery {
  email: string;
  field: "to" | "cc" | "bcc";
  status: RecipientDeliveryStatus;
}

export interface ManualEmailDeliveryStatus {
  id: string;
  status: string;
  sentAt?: string | null;
  recipients: RecipientDelivery[];
  opens: number;
  clicks: number;
  bounces: number;
  complaints: number;
}

export interface EmailPreviewResult {
  subject: string;
  html: string;
  recipients: {
    to: string[];
    cc: string[];
    bcc: string[];
    total: number;
  };
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
  "email.failed",
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
    _count?: { members: number };
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
      body: JSON.stringify({ refreshToken }),
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
  // FormData (file uploads) must set its own multipart boundary — never force a
  // JSON content type for it.
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...options.headers,
      },
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
      body: JSON.stringify(input),
    });
  },

  login(input: { email: string; password: string }) {
    return request<{
      user: { id: string; email: string; name?: string | null };
      organizations: Array<{ id: string; name: string; role: string }>;
      tokens: { accessToken: string; refreshToken: string };
    }>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  requestPasswordReset(input: { email: string }) {
    return request<{ message: string; resetToken?: string }>(
      "/api/v1/auth/password-reset/request",
      {
        method: "POST",
        body: JSON.stringify(input),
      }
    );
  },

  resetPassword(input: { token: string; password: string }) {
    return request<{ message: string }>("/api/v1/auth/password-reset/confirm", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  listOrganizations() {
    return request<Organization[]>("/api/v1/organizations");
  },

  createOrganization(input: { name: string }) {
    return request<Organization>("/api/v1/organizations", {
      method: "POST",
      body: JSON.stringify(input),
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
      body: JSON.stringify(input),
    });
  },

  updateSMTPConnection(id: string, input: Record<string, unknown>) {
    return request<SMTPConnection>(`/api/v1/smtp-connections/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },

  deleteSMTPConnection(id: string) {
    return request<void>(`/api/v1/smtp-connections/${id}`, {
      method: "DELETE",
    });
  },

  listContacts(organizationId: string) {
    return request<Contact[]>(
      `/api/v1/contacts?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  createContact(input: Record<string, unknown>) {
    return request<Contact>("/api/v1/contacts", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  updateContact(id: string, input: Record<string, unknown>) {
    return request<Contact>(`/api/v1/contacts/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },

  deleteContact(id: string) {
    return request<void>(`/api/v1/contacts/${id}`, { method: "DELETE" });
  },

  importContacts(
    file: File,
    options: { organizationId: string; contactListId?: string }
  ) {
    const form = new FormData();
    form.append("file", file);
    form.append("organizationId", options.organizationId);
    if (options.contactListId) {
      form.append("contactListId", options.contactListId);
    }
    return request<ContactImportSummary>("/api/v1/contacts/import", {
      method: "POST",
      body: form,
    });
  },

  // CSV export streams text/csv, not JSON, so it bypasses request() and returns
  // the raw CSV text for the caller to turn into a download.
  async exportContacts(organizationId: string, contactListId?: string) {
    const params = new URLSearchParams({ organizationId });
    if (contactListId) {
      params.set("contactListId", contactListId);
    }
    const { accessToken } = getSession();
    const response = await fetch(
      `${apiBaseUrl}/api/v1/contacts/export?${params.toString()}`,
      {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      }
    );
    if (!response.ok) {
      throw new ApiError("Unable to export contacts", response.status);
    }
    return response.text();
  },

  getContactActivity(
    contactId: string,
    options: { cursor?: string; limit?: number } = {}
  ) {
    const params = new URLSearchParams();
    if (options.cursor) {
      params.set("cursor", options.cursor);
    }
    if (options.limit) {
      params.set("limit", String(options.limit));
    }
    const query = params.toString();
    return request<ContactActivity>(
      `/api/v1/contacts/${contactId}/activity${query ? `?${query}` : ""}`
    );
  },

  previewSegment(input: Record<string, unknown>) {
    return request<SegmentPreview>("/api/v1/contacts/segment/preview", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  listContactLists(organizationId: string) {
    return request<ContactList[]>(
      `/api/v1/contact-lists?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  createContactList(input: Record<string, unknown>) {
    return request<ContactList>("/api/v1/contact-lists", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  updateContactList(id: string, input: Record<string, unknown>) {
    return request<ContactList>(`/api/v1/contact-lists/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },

  deleteContactList(id: string) {
    return request<void>(`/api/v1/contact-lists/${id}`, { method: "DELETE" });
  },

  createListFromSegment(input: Record<string, unknown>) {
    return request<ContactList>("/api/v1/contact-lists/from-segment", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  listSuppressions(organizationId: string) {
    return request<Suppression[]>(
      `/api/v1/suppressions?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  addSuppression(input: {
    organizationId: string;
    email: string;
    reason?: string;
  }) {
    return request<Suppression>("/api/v1/suppressions", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  deleteSuppression(id: string) {
    return request<void>(`/api/v1/suppressions/${id}`, { method: "DELETE" });
  },

  // Phase D — auto-suppression policy, throttles, segments, deliverability.

  getSuppressionPolicy(organizationId: string) {
    return request<SuppressionPolicy>(
      `/api/v1/suppressions/policy?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  updateSuppressionPolicy(input: {
    organizationId: string;
    softBounceThreshold: number;
    softBounceWindowDays: number;
  }) {
    return request<SuppressionPolicy>("/api/v1/suppressions/policy", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },

  listDomainThrottles(organizationId: string) {
    return request<DomainThrottleList>(
      `/api/v1/domain-throttles?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  upsertDomainThrottle(input: {
    organizationId: string;
    domain: string;
    maxPerMinute: number;
  }) {
    return request<DomainThrottle>("/api/v1/domain-throttles", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },

  deleteDomainThrottle(id: string) {
    return request<void>(`/api/v1/domain-throttles/${id}`, {
      method: "DELETE",
    });
  },

  listSegments(organizationId: string) {
    return request<Segment[]>(
      `/api/v1/segments?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  createSegment(input: Record<string, unknown>) {
    return request<Segment>("/api/v1/segments", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  updateSegment(id: string, input: Record<string, unknown>) {
    return request<Segment>(`/api/v1/segments/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },

  deleteSegment(id: string) {
    return request<void>(`/api/v1/segments/${id}`, { method: "DELETE" });
  },

  previewSegmentRules(input: { organizationId: string; rules: unknown }) {
    return request<SegmentPreview>("/api/v1/segments/preview", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  configureAbTest(campaignId: string, input: Record<string, unknown>) {
    return request<Campaign>(`/api/v1/campaigns/${campaignId}/ab-test`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },

  deliverabilityOverview(organizationId: string) {
    return request<DeliverabilityOverview>(
      `/api/v1/deliverability/overview?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  deliverabilityDomains(organizationId: string) {
    return request<DeliverabilityDomains>(
      `/api/v1/deliverability/domains?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  deliverabilityAlerts(organizationId: string) {
    return request<DeliverabilityAlerts>(
      `/api/v1/deliverability/alerts?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  listTemplates(organizationId: string) {
    return request<Template[]>(
      `/api/v1/templates?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  createTemplate(input: Record<string, unknown>) {
    return request<Template>("/api/v1/templates", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  updateTemplate(id: string, input: Record<string, unknown>) {
    return request<Template>(`/api/v1/templates/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
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
      body: JSON.stringify(input),
    });
  },

  updateCampaign(id: string, input: Record<string, unknown>) {
    return request<Campaign>(`/api/v1/campaigns/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },

  duplicateCampaign(id: string) {
    return request<Campaign>(`/api/v1/campaigns/${id}/duplicate`, {
      method: "POST",
    });
  },

  deleteCampaign(id: string) {
    return request<void>(`/api/v1/campaigns/${id}`, { method: "DELETE" });
  },

  sendCampaignNow(id: string) {
    return request<Campaign>(`/api/v1/campaigns/${id}/send`, {
      method: "POST",
    });
  },

  scheduleCampaign(id: string, scheduledAt: string) {
    return request<Campaign>(`/api/v1/campaigns/${id}/schedule`, {
      method: "POST",
      body: JSON.stringify({ scheduledAt }),
    });
  },

  setCampaignRecurrence(
    id: string,
    input: { cronExpression: string; timezone: string }
  ) {
    return request<Campaign>(`/api/v1/campaigns/${id}/recurrence`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  pauseCampaign(id: string) {
    return request<Campaign>(`/api/v1/campaigns/${id}/pause`, {
      method: "POST",
    });
  },

  resumeCampaign(id: string) {
    return request<Campaign>(`/api/v1/campaigns/${id}/resume`, {
      method: "POST",
    });
  },

  sendEmail(input: Record<string, unknown>) {
    return request<{ id: string; status: string }>(
      "/api/v1/transactional-email/send",
      {
        method: "POST",
        body: JSON.stringify(input),
      }
    );
  },

  sendManualEmail(input: Record<string, unknown>) {
    return request<{ id: string; status: string }>(
      "/api/v1/manual-email/send",
      {
        method: "POST",
        body: JSON.stringify(input),
      }
    );
  },

  previewEmail(input: Record<string, unknown>) {
    return request<EmailPreviewResult>("/api/v1/manual-email/preview", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  manualEmailStatus(emailJobId: string, organizationId: string) {
    return request<ManualEmailDeliveryStatus>(
      `/api/v1/manual-email/${emailJobId}/status?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  uploadAttachment(
    file: File,
    options: { organizationId: string; emailDraftId?: string }
  ) {
    const form = new FormData();
    form.append("file", file);
    form.append("organizationId", options.organizationId);
    if (options.emailDraftId) {
      form.append("emailDraftId", options.emailDraftId);
    }
    return request<EmailAttachment>("/api/v1/attachments", {
      method: "POST",
      body: form,
    });
  },

  deleteAttachment(id: string) {
    return request<void>(`/api/v1/attachments/${id}`, { method: "DELETE" });
  },

  listEmailDrafts(organizationId: string) {
    return request<EmailDraft[]>(
      `/api/v1/email-drafts?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  getEmailDraft(id: string) {
    return request<EmailDraft>(`/api/v1/email-drafts/${id}`);
  },

  listOrganizationMembers(organizationId: string) {
    return request<OrganizationMember[]>(
      `/api/v1/organizations/${organizationId}/members`
    );
  },

  createEmailDraft(input: Record<string, unknown>) {
    return request<EmailDraft>("/api/v1/email-drafts", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  updateEmailDraft(id: string, input: Record<string, unknown>) {
    return request<EmailDraft>(`/api/v1/email-drafts/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },

  deleteEmailDraft(id: string) {
    return request<void>(`/api/v1/email-drafts/${id}`, { method: "DELETE" });
  },

  listInboxAccounts(organizationId: string) {
    return request<InboxAccount[]>(
      `/api/v1/inbox/accounts?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  createInboxAccount(input: Record<string, unknown>) {
    return request<InboxAccount>("/api/v1/inbox/accounts", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  updateInboxAccount(id: string, input: Record<string, unknown>) {
    return request<InboxAccount>(
      `/api/v1/inbox/accounts/${id}?organizationId=${encodeURIComponent(String(input.organizationId ?? ""))}`,
      {
        method: "PATCH",
        body: JSON.stringify(input),
      }
    );
  },

  deleteInboxAccount(id: string, organizationId: string) {
    return request<void>(
      `/api/v1/inbox/accounts/${id}?organizationId=${encodeURIComponent(organizationId)}`,
      { method: "DELETE" }
    );
  },

  listInboundMessages(input: {
    organizationId: string;
    q?: string;
    read?: "read" | "unread" | "all";
    cursor?: string;
  }) {
    const params = new URLSearchParams({
      organizationId: input.organizationId,
    });
    if (input.q) params.set("q", input.q);
    if (input.read) params.set("read", input.read);
    if (input.cursor) params.set("cursor", input.cursor);
    return request<InboundMessageList>(
      `/api/v1/inbox/messages?${params.toString()}`
    );
  },

  markInboundMessageRead(
    id: string,
    input: { organizationId: string; read: boolean }
  ) {
    return request<InboundMessage>(
      `/api/v1/inbox/messages/${id}/read?organizationId=${encodeURIComponent(input.organizationId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ read: input.read }),
      }
    );
  },

  replyToInboundMessage(
    id: string,
    input: {
      organizationId: string;
      smtpConnectionId?: string;
      subject: string;
      html?: string;
      text?: string;
    }
  ) {
    return request<{ id: string; status: string }>(
      `/api/v1/inbox/messages/${id}/reply?organizationId=${encodeURIComponent(input.organizationId)}`,
      {
        method: "POST",
        body: JSON.stringify(input),
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
      body: JSON.stringify(input),
    });
  },

  revokeApiKey(id: string) {
    return request<ApiKey>(`/api/v1/api-keys/${id}/revoke`, {
      method: "POST",
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
        body: JSON.stringify(input),
      }
    );
  },

  deleteWebhookEndpoint(id: string) {
    return request<void>(`/api/v1/webhook-endpoints/${id}`, {
      method: "DELETE",
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
        method: "POST",
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
        body: JSON.stringify({ organizationId }),
      }
    );
  },
};
