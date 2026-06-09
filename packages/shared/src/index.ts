import { z } from "zod";

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
  subject: string;
  status: CampaignStatus;
  scheduledAt?: string | null;
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

export const sendEmailSchema = z.object({
  to: emailAddressSchema,
  templateId: z.string().min(1).optional(),
  subject: z.string().min(1).optional(),
  html: z.string().optional(),
  text: z.string().optional(),
  variables: z.record(z.unknown()).optional()
});

export type SendEmailInput = z.infer<typeof sendEmailSchema>;

export const smtpConnectionSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().positive(),
  secure: z.boolean(),
  username: z.string().min(1),
  password: z.string().min(1),
  fromEmail: emailAddressSchema,
  fromName: z.string().optional()
});

export type SMTPConnectionInput = z.infer<typeof smtpConnectionSchema>;
