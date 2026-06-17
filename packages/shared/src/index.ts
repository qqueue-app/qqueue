import { CronExpressionParser } from "cron-parser";
import { z } from "zod";

/** True when `value` is a parseable 5/6-field cron expression. */
export function isValidCron(value: string): boolean {
  try {
    CronExpressionParser.parse(value);
    return true;
  } catch {
    return false;
  }
}

/** True when `value` is an IANA timezone the runtime recognises. */
export function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export type UserRole = "OWNER" | "ADMIN" | "MEMBER";
export type ContactStatus = "ACTIVE" | "UNSUBSCRIBED" | "BOUNCED";
export type MembershipSource = "MANUAL" | "CSV_IMPORT" | "SEGMENT";
export type SuppressionReason =
  | "BOUNCE"
  | "COMPLAINT"
  | "UNSUBSCRIBE"
  | "MANUAL";
export type BounceType = "HARD" | "SOFT" | "BLOCK";
export type CampaignStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "SENDING"
  | "PAUSED"
  | "SENT"
  | "CANCELLED";
export type EmailJobStatus =
  | "PENDING"
  | "QUEUED"
  | "PROCESSING"
  | "SENT"
  | "FAILED"
  | "CANCELLED"
  | "SUPPRESSED";
export type EmailEventType =
  | "QUEUED"
  | "SENT"
  | "DELIVERED"
  | "OPENED"
  | "CLICKED"
  | "BOUNCED"
  | "COMPLAINED"
  | "FAILED";
export type EmailOrigin = "CAMPAIGN" | "TRANSACTIONAL" | "MANUAL";
export type ApiErrorCode =
  | "invalid_api_key"
  | "missing_smtp_connection"
  | "invalid_template"
  | "smtp_failure"
  | "invalid_schedule"
  | "validation_error"
  | "attachment_too_large"
  | "feature_disabled"
  | "not_found"
  | "conflict";

export interface User {
  id: string;
  email: string;
  name?: string | null;
  createdAt: string;
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
  status: ContactStatus;
  tags: string[];
  metadata?: Record<string, unknown>;
}

export interface ContactList {
  id: string;
  organizationId: string;
  name: string;
  description?: string | null;
  createdAt: string;
}

export interface ContactListMember {
  id: string;
  contactId: string;
  contactListId: string;
  addedAt: string;
  source: MembershipSource;
}

export interface Suppression {
  id: string;
  organizationId: string;
  email: string;
  reason: SuppressionReason;
  source?: string | null;
  createdAt: string;
}

export interface SuppressionPolicy {
  organizationId: string;
  softBounceThreshold: number;
  softBounceWindowDays: number;
}

export interface DomainThrottle {
  id: string;
  organizationId: string;
  /** Recipient domain; "" is the org-wide default cap. */
  domain: string;
  maxPerMinute: number;
}

export type InboxAccountStatus = "ACTIVE" | "DISABLED";

export interface InboxAccount {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  host: string;
  port: number;
  secure: boolean;
  mailbox: string;
  status: InboxAccountStatus;
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
  assignedToUserId?: string | null;
  imapUid?: number | null;
  assignedTo?: {
    id: string;
    email: string;
    name?: string | null;
  } | null;
  emailJob?: {
    id: string;
    subject: string;
    toEmail: string;
    messageId?: string | null;
  } | null;
}

export interface InboundMessageNote {
  id: string;
  organizationId: string;
  inboundMessageId: string;
  authorUserId: string;
  body: string;
  createdAt: string;
  author: {
    id: string;
    email: string;
    name?: string | null;
  };
}

export interface Template {
  id: string;
  organizationId: string;
  name: string;
  subject: string;
  /** Compiled, email-safe HTML (the artifact actually sent). */
  html: string;
  /** MJML source when authored through the MJML render layer; null otherwise. */
  mjml?: string | null;
  text?: string | null;
}

export interface Campaign {
  id: string;
  organizationId: string;
  name: string;
  status: CampaignStatus;
  scheduledAt?: string | null;
  cronExpression?: string | null;
  timezone?: string | null;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
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

export interface EmailJob {
  id: string;
  organizationId: string;
  to: string;
  cc?: string[];
  bcc?: string[];
  replyTo?: string | null;
  subject: string;
  templateId?: string | null;
  campaignId?: string | null;
  origin: EmailOrigin;
  createdByUserId?: string | null;
  status: EmailJobStatus;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  variables?: Record<string, unknown>;
}

export interface EmailEvent {
  id: string;
  organizationId: string;
  emailJobId: string;
  type: EmailEventType;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}

export interface TransactionalSendResponse {
  id: string;
  status: EmailJobStatus;
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

export type OutboundWebhookEventName =
  | "email.queued"
  | "email.sent"
  | "email.delivered"
  | "email.opened"
  | "email.clicked"
  | "email.bounced"
  | "email.complained"
  | "email.failed";

export interface WebhookEndpoint {
  id: string;
  organizationId: string;
  name: string;
  url: string;
  events: OutboundWebhookEventName[];
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
  eventName: OutboundWebhookEventName;
  status: string;
  attempts: number;
  responseStatus?: number | null;
  error?: string | null;
  nextAttemptAt?: string | null;
  deliveredAt?: string | null;
  createdAt: string;
}

export const emailAddressSchema = z.string().email();

export const registerSchema = z.object({
  email: emailAddressSchema,
  password: z.string().min(8),
  name: z.string().optional(),
  organizationName: z.string().min(1).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailAddressSchema,
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RefreshInput = z.infer<typeof refreshSchema>;

export const passwordResetRequestSchema = z.object({
  email: emailAddressSchema,
});

export type PasswordResetRequestInput = z.infer<
  typeof passwordResetRequestSchema
>;

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(32),
  password: z.string().min(8),
});

export type PasswordResetConfirmInput = z.infer<
  typeof passwordResetConfirmSchema
>;

export const organizationSchema = z.object({
  name: z.string().min(1),
});

export type OrganizationInput = z.infer<typeof organizationSchema>;

export const contactSchema = z.object({
  organizationId: z.string().min(1),
  email: emailAddressSchema,
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  tags: z.array(z.string().min(1)).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type ContactInput = z.infer<typeof contactSchema>;

export const contactListSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  contactIds: z.array(z.string().min(1)).optional(),
});

export type ContactListInput = z.infer<typeof contactListSchema>;

export const contactListUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  contactIds: z.array(z.string().min(1)).optional(),
});

export type ContactListUpdateInput = z.infer<typeof contactListUpdateSchema>;

// Phase C — contacts & lists enhancements.

// Tag-driven segment filter. `match: ANY` matches contacts with at least one of
// the tags; `ALL` requires every tag. Optional status narrows to a single
// ContactStatus (defaults to all statuses when omitted).
export const segmentFilterSchema = z.object({
  organizationId: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1),
  match: z.enum(["ANY", "ALL"]).default("ANY"),
  status: z.enum(["ACTIVE", "UNSUBSCRIBED", "BOUNCED"]).optional(),
});

export type SegmentFilterInput = z.infer<typeof segmentFilterSchema>;

// Materialize a tag filter into a new contact list (members tagged SEGMENT).
export const createListFromSegmentSchema = segmentFilterSchema.extend({
  name: z.string().min(1),
  description: z.string().optional(),
});

export type CreateListFromSegmentInput = z.infer<
  typeof createListFromSegmentSchema
>;

// Phase D — dynamic segmentation. A rule tree that re-resolves to the current
// matching contacts at send time (vs. the Phase C static "create list from
// segment" snapshot above).

export type SegmentRule =
  | { op: "AND" | "OR"; rules: SegmentRule[] }
  | { field: "tags"; match: "ANY" | "ALL" | "NONE"; values: string[] }
  | { field: "status"; eq: ContactStatus }
  | { field: "emailDomain"; eq: string }
  | { field: "createdAt"; before?: string; after?: string };

export const segmentRuleSchema: z.ZodType<SegmentRule> = z.lazy(() =>
  z.union([
    z.object({
      op: z.enum(["AND", "OR"]),
      rules: z.array(segmentRuleSchema).min(1).max(20),
    }),
    z.object({
      field: z.literal("tags"),
      match: z.enum(["ANY", "ALL", "NONE"]),
      values: z.array(z.string().min(1)).min(1),
    }),
    z.object({
      field: z.literal("status"),
      eq: z.enum(["ACTIVE", "UNSUBSCRIBED", "BOUNCED"]),
    }),
    z.object({ field: z.literal("emailDomain"), eq: z.string().min(1) }),
    z.object({
      field: z.literal("createdAt"),
      before: z.string().datetime().optional(),
      after: z.string().datetime().optional(),
    }),
  ])
);

const MAX_SEGMENT_RULE_DEPTH = 5;

function segmentRuleDepth(rule: SegmentRule): number {
  if ("op" in rule) {
    return 1 + Math.max(...rule.rules.map(segmentRuleDepth));
  }
  return 1;
}

// Bound nesting so a pathological tree can't blow up query compilation.
const boundedSegmentRule = segmentRuleSchema.refine(
  (rule) => segmentRuleDepth(rule) <= MAX_SEGMENT_RULE_DEPTH,
  `Segment rules may not nest deeper than ${MAX_SEGMENT_RULE_DEPTH} levels`
);

export const segmentSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  rules: boundedSegmentRule,
});

export type SegmentInput = z.infer<typeof segmentSchema>;

export const segmentUpdateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  rules: boundedSegmentRule,
});

export type SegmentUpdateInput = z.infer<typeof segmentUpdateSchema>;

export const segmentPreviewSchema = z.object({
  organizationId: z.string().min(1),
  rules: boundedSegmentRule,
});

export type SegmentPreviewInput = z.infer<typeof segmentPreviewSchema>;

export interface Segment {
  id: string;
  organizationId: string;
  name: string;
  description?: string | null;
  rules: SegmentRule;
  createdAt: string;
}

/**
 * Compile a segment rule tree into a Prisma `ContactWhereInput`-shaped plain
 * object (returned untyped so this stays free of a Prisma dependency). Callers
 * AND it with `organizationId` (and, at send time, `status: ACTIVE`). Shared by
 * the API preview/resolve paths and the worker's campaign fan-out.
 */
export function compileSegmentRules(
  rule: SegmentRule
): Record<string, unknown> {
  if ("op" in rule) {
    const compiled = rule.rules.map(compileSegmentRules);
    return rule.op === "AND" ? { AND: compiled } : { OR: compiled };
  }

  switch (rule.field) {
    case "tags":
      if (rule.match === "ALL") {
        return { tags: { hasEvery: rule.values } };
      }
      if (rule.match === "NONE") {
        return { NOT: { tags: { hasSome: rule.values } } };
      }
      return { tags: { hasSome: rule.values } };
    case "status":
      return { status: rule.eq };
    case "emailDomain":
      return {
        email: { endsWith: `@${rule.eq.toLowerCase()}`, mode: "insensitive" },
      };
    case "createdAt":
      return {
        createdAt: {
          ...(rule.after ? { gte: rule.after } : {}),
          ...(rule.before ? { lte: rule.before } : {}),
        },
      };
  }
}

// CSV import options. The CSV payload itself is handled by the upload middleware,
// not validated here; this only carries the optional target list.
export const csvImportSchema = z.object({
  organizationId: z.string().min(1),
  contactListId: z.string().min(1).optional(),
});

export type CsvImportInput = z.infer<typeof csvImportSchema>;

export const suppressionCreateSchema = z.object({
  organizationId: z.string().min(1),
  email: emailAddressSchema,
  reason: z
    .enum(["BOUNCE", "COMPLAINT", "UNSUBSCRIBE", "MANUAL"])
    .default("MANUAL"),
});

export type SuppressionCreateInput = z.infer<typeof suppressionCreateSchema>;

export const suppressionPolicySchema = z.object({
  organizationId: z.string().min(1),
  softBounceThreshold: z.coerce.number().int().min(1).max(100),
  softBounceWindowDays: z.coerce.number().int().min(1).max(365),
});

export type SuppressionPolicyInput = z.infer<typeof suppressionPolicySchema>;

export const domainThrottleSchema = z.object({
  organizationId: z.string().min(1),
  // "" targets the org-wide default; otherwise a bare recipient domain.
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .refine(
      (value) => value === "" || /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value),
      "Must be a valid domain or empty for the default"
    )
    .default(""),
  maxPerMinute: z.coerce.number().int().min(1).max(100000),
});

export type DomainThrottleInput = z.infer<typeof domainThrottleSchema>;

export const inboxAccountSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().trim().min(1),
  email: emailAddressSchema,
  host: z.string().trim().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(993),
  secure: z
    .union([
      z.boolean(),
      z.enum(["true", "false"]).transform((v) => v === "true"),
    ])
    .default(true),
  username: z.string().min(1),
  password: z.string().min(1),
  mailbox: z.string().trim().min(1).default("INBOX"),
});

export type InboxAccountInput = z.infer<typeof inboxAccountSchema>;

export const inboxAccountUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});

export type InboxAccountUpdateInput = z.infer<typeof inboxAccountUpdateSchema>;

export const inboundMessageStoreSchema = z.object({
  organizationId: z.string().min(1),
  inboxAccountId: z.string().min(1),
  messageId: z.string().min(1),
  inReplyTo: z.string().min(1).optional(),
  references: z.array(z.string().min(1)).default([]),
  fromEmail: emailAddressSchema,
  fromName: z.string().optional(),
  to: z.array(emailAddressSchema).default([]),
  cc: z.array(emailAddressSchema).default([]),
  subject: z.string().default(""),
  text: z.string().optional(),
  html: z.string().optional(),
  receivedAt: z.string().datetime(),
  imapUid: z.coerce.number().int().positive().optional(),
});

export type InboundMessageStoreInput = z.infer<
  typeof inboundMessageStoreSchema
>;

export const inboundMessageQuerySchema = z.object({
  organizationId: z.string().min(1),
  q: z.string().trim().min(1).optional(),
  read: z.enum(["read", "unread", "all"]).default("all").optional(),
  assignedToUserId: z.string().min(1).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type InboundMessageQueryInput = z.infer<
  typeof inboundMessageQuerySchema
>;

export const inboundMessageAssignmentSchema = z.object({
  organizationId: z.string().min(1),
  assignedToUserId: z.string().min(1).nullable().optional(),
});

export type InboundMessageAssignmentInput = z.infer<
  typeof inboundMessageAssignmentSchema
>;

export const inboundMessageNoteSchema = z.object({
  organizationId: z.string().min(1),
  body: z.string().trim().min(1).max(5000),
});

export type InboundMessageNoteInput = z.infer<
  typeof inboundMessageNoteSchema
>;

export const inboundMessageReplySchema = z
  .object({
    organizationId: z.string().min(1),
    smtpConnectionId: z.string().min(1).optional(),
    subject: z.string().min(1),
    html: z.string().optional(),
    text: z.string().optional(),
  })
  .refine((input) => Boolean(input.html || input.text), {
    message: "Provide an email body",
    path: ["html"],
  });

export type InboundMessageReplyInput = z.infer<
  typeof inboundMessageReplySchema
>;

export const contactActivityQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ContactActivityQueryInput = z.infer<
  typeof contactActivityQuerySchema
>;

export const templateSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1),
  subject: z.string().min(1),
  html: z.string().min(1),
  mjml: z.string().optional(),
  text: z.string().optional(),
});

export type TemplateInput = z.infer<typeof templateSchema>;

// A campaign targets a static contact list OR a dynamic segment, never both.
const campaignTargetExclusive = (
  data: { contactListId?: string; segmentId?: string },
  ctx: z.RefinementCtx
) => {
  if (data.contactListId && data.segmentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide either contactListId or segmentId, not both",
      path: ["segmentId"],
    });
  }
};

export const campaignSchema = z
  .object({
    organizationId: z.string().min(1),
    name: z.string().min(1),
    templateId: z.string().min(1).optional(),
    contactListId: z.string().min(1).optional(),
    segmentId: z.string().min(1).optional(),
    scheduledAt: z.string().datetime().optional(),
  })
  .superRefine(campaignTargetExclusive);

export type CampaignInput = z.infer<typeof campaignSchema>;

export const campaignUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    templateId: z.string().min(1).optional(),
    contactListId: z.string().min(1).optional(),
    segmentId: z.string().min(1).optional(),
    scheduledAt: z.string().datetime().optional(),
  })
  .superRefine(campaignTargetExclusive);

export type CampaignUpdateInput = z.infer<typeof campaignUpdateSchema>;

// Phase D — A/B subject testing.

export type AbWinnerMetric = "OPEN" | "CLICK";
export type AbTestStatus = "TESTING" | "DECIDED" | "SENT";

export interface CampaignVariant {
  id: string;
  campaignId: string;
  label: string;
  subject: string;
  isWinner: boolean;
}

// Configure (or disable) a campaign's A/B subject test. When `enabled`, all of
// percent/metric/windowMin and at least two variants are required.
export const abTestConfigSchema = z
  .object({
    enabled: z.boolean(),
    percent: z.coerce.number().int().min(1).max(50).optional(),
    metric: z.enum(["OPEN", "CLICK"]).optional(),
    windowMin: z.coerce.number().int().min(1).max(10080).optional(),
    variants: z
      .array(
        z.object({
          label: z.string().min(1).max(40),
          subject: z.string().min(1).max(500),
        })
      )
      .min(2)
      .max(5)
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.enabled) {
      return;
    }
    if (data.percent === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "percent is required when A/B testing is enabled",
        path: ["percent"],
      });
    }
    if (!data.metric) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "metric is required when A/B testing is enabled",
        path: ["metric"],
      });
    }
    if (data.windowMin === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "windowMin is required when A/B testing is enabled",
        path: ["windowMin"],
      });
    }
    if (!data.variants || data.variants.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least two variants are required",
        path: ["variants"],
      });
    }
  });

export type AbTestConfigInput = z.infer<typeof abTestConfigSchema>;

// Phase D — deliverability tooling. A time-windowed view over EmailEvent +
// Suppression. `from`/`to` are ISO datetimes; the service defaults to the last
// 30 days when omitted.
export const deliverabilityQuerySchema = z.object({
  organizationId: z.string().min(1),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type DeliverabilityQueryInput = z.infer<
  typeof deliverabilityQuerySchema
>;

export const campaignScheduleSchema = z.object({
  scheduledAt: z.string().datetime(),
});

export type CampaignScheduleInput = z.infer<typeof campaignScheduleSchema>;

export const cronExpressionSchema = z
  .string()
  .min(1)
  .refine(isValidCron, { message: "Invalid cron expression" });

export const timezoneSchema = z
  .string()
  .min(1)
  .refine(isValidTimezone, { message: "Invalid timezone" });

export const campaignRecurrenceSchema = z.object({
  cronExpression: cronExpressionSchema,
  timezone: timezoneSchema,
});

export type CampaignRecurrenceInput = z.infer<typeof campaignRecurrenceSchema>;

export const sendEmailSchema = z.object({
  organizationId: z.string().min(1),
  to: emailAddressSchema,
  cc: z.array(emailAddressSchema).optional(),
  bcc: z.array(emailAddressSchema).optional(),
  replyTo: emailAddressSchema.optional(),
  smtpConnectionId: z.string().min(1).optional(),
  templateId: z.string().min(1).optional(),
  subject: z.string().min(1).optional(),
  html: z.string().optional(),
  text: z.string().optional(),
  variables: z.record(z.unknown()).optional(),
  inReplyTo: z.string().min(1).optional(),
  references: z.array(z.string().min(1)).optional(),
  scheduledAt: z.string().datetime().optional(),
  // Ids of attachments uploaded ahead of time (POST /attachments). Their blobs
  // live in object storage; the send pipeline links them to the EmailJob and the
  // worker streams them to SMTP.
  attachmentIds: z.array(z.string().min(1)).optional(),
});

export type SendEmailInput = z.infer<typeof sendEmailSchema>;

export const publicSendEmailSchema = sendEmailSchema.omit({
  organizationId: true,
});

export type PublicSendEmailInput = z.infer<typeof publicSendEmailSchema>;

// Email Studio (manual composer). A manual send is one message addressed to one
// or more recipients, optionally with CC/BCC, drawn from manually-typed
// addresses, individual contacts, and/or whole contact lists. Recipients are
// resolved and deduplicated server-side before the message flows through the
// same pipeline as transactional/campaign sends (origin = MANUAL).
export const manualEmailSendSchema = z
  .object({
    organizationId: z.string().min(1),
    to: z.array(emailAddressSchema).optional(),
    cc: z.array(emailAddressSchema).optional(),
    bcc: z.array(emailAddressSchema).optional(),
    contactIds: z.array(z.string().min(1)).optional(),
    listIds: z.array(z.string().min(1)).optional(),
    replyTo: emailAddressSchema.optional(),
    smtpConnectionId: z.string().min(1).optional(),
    templateId: z.string().min(1).optional(),
    subject: z.string().min(1),
    html: z.string().optional(),
    text: z.string().optional(),
    variables: z.record(z.unknown()).optional(),
    inReplyTo: z.string().min(1).optional(),
    references: z.array(z.string().min(1)).optional(),
    scheduledAt: z.string().datetime().optional(),
    attachmentIds: z.array(z.string().min(1)).optional(),
  })
  .refine(
    (input) =>
      (input.to?.length ?? 0) +
        (input.contactIds?.length ?? 0) +
        (input.listIds?.length ?? 0) >
      0,
    { message: "At least one recipient is required", path: ["to"] }
  )
  .refine((input) => Boolean(input.html || input.text), {
    message: "Provide an email body",
    path: ["html"],
  });

export type ManualEmailSendInput = z.infer<typeof manualEmailSendSchema>;

// Preview renders the composed body through the exact same MJML + tracking
// pipeline used when sending, so the preview matches the delivered email. All
// fields are optional so a half-finished draft can still be previewed.
export const emailPreviewSchema = z.object({
  organizationId: z.string().min(1),
  subject: z.string().optional(),
  html: z.string().optional(),
  text: z.string().optional(),
  to: z.array(z.string()).optional(),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  contactIds: z.array(z.string().min(1)).optional(),
  listIds: z.array(z.string().min(1)).optional(),
});

export type EmailPreviewInput = z.infer<typeof emailPreviewSchema>;

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

// Per-recipient delivery status for a manual send. A manual send is one EmailJob
// addressed to many recipients, so granularity is derived from the SMTP
// accepted/rejected result recorded on the SENT/BOUNCED events plus thread-level
// engagement events — not separate jobs per recipient.
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

// Draft persistence for the composer. Drafts are intentionally permissive (the
// recipient arrays are plain strings, not validated emails) so an in-progress
// message can always be saved. Validation happens at send time.
export const emailDraftSchema = z.object({
  organizationId: z.string().min(1),
  subject: z.string().optional(),
  html: z.string().optional(),
  text: z.string().optional(),
  to: z.array(z.string()).optional(),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  contactIds: z.array(z.string().min(1)).optional(),
  listIds: z.array(z.string().min(1)).optional(),
  replyTo: z.string().optional(),
  smtpConnectionId: z.string().optional(),
  templateId: z.string().optional(),
  variables: z.record(z.unknown()).optional(),
});

export type EmailDraftInput = z.infer<typeof emailDraftSchema>;

export const emailDraftUpdateSchema = emailDraftSchema
  .omit({ organizationId: true })
  .partial();

export type EmailDraftUpdateInput = z.infer<typeof emailDraftUpdateSchema>;

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
  createdAt: string;
  updatedAt: string;
}

export const apiKeyCreateSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1),
});

export type ApiKeyCreateInput = z.infer<typeof apiKeyCreateSchema>;

export const outboundWebhookEventNames = [
  "email.queued",
  "email.sent",
  "email.delivered",
  "email.opened",
  "email.clicked",
  "email.bounced",
  "email.complained",
  "email.failed",
] as const;

export const outboundWebhookEventNameSchema = z.enum(outboundWebhookEventNames);

export const webhookEndpointSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
  events: z.array(outboundWebhookEventNameSchema).min(1),
  enabled: z.boolean().optional(),
});

export type WebhookEndpointInput = z.infer<typeof webhookEndpointSchema>;

export const webhookEndpointUpdateSchema = webhookEndpointSchema
  .omit({ organizationId: true })
  .partial()
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one field is required",
  });

export type WebhookEndpointUpdateInput = z.infer<
  typeof webhookEndpointUpdateSchema
>;

export const smtpConnectionSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().positive(),
  secure: z.boolean(),
  username: z.string().min(1),
  password: z.string().min(1),
  fromEmail: emailAddressSchema,
  fromName: z.string().optional(),
  isDefault: z.boolean().optional(),
});

export type SMTPConnectionInput = z.infer<typeof smtpConnectionSchema>;

export const smtpConnectionUpdateSchema = smtpConnectionSchema.partial();

export type SMTPConnectionUpdateInput = z.infer<
  typeof smtpConnectionUpdateSchema
>;
