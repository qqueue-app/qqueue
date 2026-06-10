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
  | "CANCELLED";
export type EmailEventType =
  | "QUEUED"
  | "SENT"
  | "DELIVERED"
  | "OPENED"
  | "CLICKED"
  | "BOUNCED"
  | "COMPLAINED"
  | "FAILED";

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
  metadata?: Record<string, unknown>;
}

export interface ContactList {
  id: string;
  organizationId: string;
  name: string;
  createdAt: string;
}

export interface Template {
  id: string;
  organizationId: string;
  name: string;
  subject: string;
  html: string;
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
  subject: string;
  templateId?: string | null;
  campaignId?: string | null;
  status: EmailJobStatus;
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

export const emailAddressSchema = z.string().email();

export const registerSchema = z.object({
  email: emailAddressSchema,
  password: z.string().min(8),
  name: z.string().optional(),
  organizationName: z.string().min(1).optional()
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailAddressSchema,
  password: z.string().min(1)
});

export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1)
});

export type RefreshInput = z.infer<typeof refreshSchema>;

export const organizationSchema = z.object({
  name: z.string().min(1)
});

export type OrganizationInput = z.infer<typeof organizationSchema>;

export const contactSchema = z.object({
  organizationId: z.string().min(1),
  email: emailAddressSchema,
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});

export type ContactInput = z.infer<typeof contactSchema>;

export const contactListSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1),
  contactIds: z.array(z.string().min(1)).optional()
});

export type ContactListInput = z.infer<typeof contactListSchema>;

export const contactListUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  contactIds: z.array(z.string().min(1)).optional()
});

export type ContactListUpdateInput = z.infer<typeof contactListUpdateSchema>;

export const templateSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1),
  subject: z.string().min(1),
  html: z.string().min(1),
  text: z.string().optional()
});

export type TemplateInput = z.infer<typeof templateSchema>;

export const campaignSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1),
  templateId: z.string().min(1).optional(),
  contactListId: z.string().min(1).optional(),
  scheduledAt: z.string().datetime().optional()
});

export type CampaignInput = z.infer<typeof campaignSchema>;

export const campaignUpdateSchema = campaignSchema
  .omit({ organizationId: true })
  .partial();

export type CampaignUpdateInput = z.infer<typeof campaignUpdateSchema>;

export const campaignScheduleSchema = z.object({
  scheduledAt: z.string().datetime()
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
  timezone: timezoneSchema
});

export type CampaignRecurrenceInput = z.infer<typeof campaignRecurrenceSchema>;

export const sendEmailSchema = z.object({
  organizationId: z.string().min(1),
  to: emailAddressSchema,
  smtpConnectionId: z.string().min(1).optional(),
  templateId: z.string().min(1).optional(),
  subject: z.string().min(1).optional(),
  html: z.string().optional(),
  text: z.string().optional(),
  variables: z.record(z.unknown()).optional(),
  scheduledAt: z.string().datetime().optional()
});

export type SendEmailInput = z.infer<typeof sendEmailSchema>;

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
  isDefault: z.boolean().optional()
});

export type SMTPConnectionInput = z.infer<typeof smtpConnectionSchema>;

export const smtpConnectionUpdateSchema = smtpConnectionSchema.partial();

export type SMTPConnectionUpdateInput = z.infer<
  typeof smtpConnectionUpdateSchema
>;
