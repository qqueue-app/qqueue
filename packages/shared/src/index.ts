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

/**
 * Next fire time for a cron expression in the given timezone, or null when the
 * expression cannot be parsed. Shared by the API (campaign scheduling) and the
 * worker (recurring campaign runs) so both agree on the next-run calculation.
 */
export function nextCronRun(
  cronExpression: string,
  timezone?: string | null,
  from: Date = new Date()
): Date | null {
  try {
    const interval = CronExpressionParser.parse(cronExpression, {
      currentDate: from,
      tz: timezone ?? "UTC"
    });
    return interval.next().toDate();
  } catch {
    return null;
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
export type EmailOrigin = "CAMPAIGN" | "TRANSACTIONAL" | "MANUAL" | "SYSTEM";
export type ApiErrorCode =
  | "invalid_api_key"
  | "missing_smtp_connection"
  | "invalid_template"
  | "smtp_failure"
  | "invalid_schedule"
  | "validation_error"
  | "attachment_too_large"
  | "image_too_large"
  | "unsupported_image_type"
  | "not_found"
  | "conflict"
  | "send_as_denied"
  // Reading a mailbox the caller holds no grant for. Distinct from
  // send_as_denied, which is about sending as one.
  | "mailbox_access_denied"
  | "org_create_denied"
  | "domain_not_granted"
  | "mailcow_not_configured"
  | "mailcow_unreachable"
  | "mailcow_auth_failed"
  | "mailcow_error";

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

/** An org's auto-suppression policy after falling back to instance defaults. */
export interface EffectiveSuppressionPolicy {
  softBounceThreshold: number;
  softBounceWindowDays: number;
}

/**
 * The org's effective auto-suppression policy: its row's values when present,
 * otherwise the instance defaults (env-provided by the caller).
 */
export function resolveSuppressionPolicy(
  row:
    | { softBounceThreshold?: number | null; softBounceWindowDays?: number | null }
    | null
    | undefined,
  defaults: EffectiveSuppressionPolicy
): EffectiveSuppressionPolicy {
  return {
    softBounceThreshold:
      row?.softBounceThreshold ?? defaults.softBounceThreshold,
    softBounceWindowDays:
      row?.softBounceWindowDays ?? defaults.softBounceWindowDays
  };
}

/**
 * Decide whether a bounce should suppress the address now. Hard bounces and
 * blocks suppress immediately; a soft bounce only suppresses once the address's
 * soft-bounce count within the policy window reaches the threshold. Call AFTER
 * recording the BOUNCED event so the current bounce counts.
 *
 * This is the single copy of the decision the API and worker used to duplicate;
 * the caller supplies the event count (shared code stays database-free and
 * browser-safe).
 */
export async function shouldSuppressBounce(input: {
  bounceType: BounceType;
  policy: EffectiveSuppressionPolicy;
  /** SOFT BOUNCED events for the address in the org since `windowStart`. */
  countSoftBouncesSince: (windowStart: Date) => Promise<number>;
}): Promise<boolean> {
  if (input.bounceType !== "SOFT") {
    return true;
  }
  const windowStart = new Date(
    Date.now() - input.policy.softBounceWindowDays * 24 * 60 * 60 * 1000
  );
  const softCount = await input.countSoftBouncesSince(windowStart);
  return softCount >= input.policy.softBounceThreshold;
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
  imapUid?: number | null;
  emailJob?: {
    id: string;
    subject: string;
    toEmail: string;
    messageId?: string | null;
  } | null;
}

/** A managed personalization variable surfaced in the template editor. */
export interface TemplateVariable {
  /** Token name used in `{{name}}`. */
  name: string;
  /** Human label shown in the variables panel. */
  label?: string | null;
  /** Value substituted when a send/preview supplies no value for this var. */
  defaultValue?: string | null;
  /** When true, the editor warns if no value is provided at send time. */
  required?: boolean;
}

export interface Template {
  id: string;
  organizationId: string;
  name: string;
  /** Short human description shown on template cards. */
  description?: string | null;
  /** Free-text grouping (e.g. "Onboarding") used for dashboard filtering. */
  category?: string | null;
  /** Free-form tags for filtering. */
  tags?: string[];
  subject: string;
  /** Compiled, email-safe HTML (the artifact actually sent). */
  html: string;
  /** MJML source when authored through the MJML render layer; null otherwise. */
  mjml?: string | null;
  text?: string | null;
  /** Managed variable definitions driving the editor's variables panel. */
  variables?: TemplateVariable[] | null;
  /** Saved sample data ({ varName: value }) so previews are reproducible. */
  previewData?: Record<string, string> | null;
  createdAt?: string;
  updatedAt?: string;
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
  /** Default Reply-To applied to every send on this connection. */
  replyTo?: string | null;
  isDefault: boolean;
}

/** Send-as permission: lets a MEMBER send from a specific connection. */
export interface SmtpConnectionGrant {
  id: string;
  organizationId: string;
  smtpConnectionId: string;
  userId: string;
  createdAt: string;
  user?: { id: string; email: string; name?: string | null };
}

/** Instance Mailcow provisioning status, as shown on the Mailboxes page. */
export interface MailcowStatus {
  configured: boolean;
  reachable: boolean;
  /**
   * Active Mailcow domains the *caller* may provision under: those an instance
   * administrator assigned to this org, narrowed for an ADMIN to their granted
   * ones. An org with no assigned domains gets an empty list.
   */
  domains: string[];
  /** Host provisioned mailboxes use for SMTP/IMAP (for mail-client setup). */
  mailHost: string | null;
  /** True when `domains` was narrowed by domain grants (ADMIN caller). */
  restricted?: boolean;
  error?: string;
}

/**
 * Where a domain's DNS is hosted, detected from its live NS records.
 *
 * `OTHER` means nameservers resolved but matched no known host; `UNKNOWN`
 * means the lookup itself failed, which is also what a brand-new domain looks
 * like. The UI must not treat those two as the same thing.
 */
export type MailDnsProvider =
  | "CLOUDFLARE"
  | "ROUTE53"
  | "GODADDY"
  | "NAMECHEAP"
  | "GOOGLE"
  | "DIGITALOCEAN"
  | "VULTR"
  | "HETZNER"
  | "LINODE"
  | "NS1"
  | "DNSIMPLE"
  | "NAMECOM"
  | "PORKBUN"
  | "AZURE"
  | "OTHER"
  | "UNKNOWN";

/** Whether a required record was found in live DNS. */
export type MailDnsRecordStatus =
  /** Present and correct. */
  | "OK"
  /** Resolved cleanly, and this record is not there. */
  | "MISSING"
  /** The lookup failed — says nothing about the zone. */
  | "UNKNOWN";

/** One DNS record a Mailcow domain needs, and whether it is published. */
export interface MailDnsRecord {
  /** Stable identifier (`mx`, `spf`, `dkim`, `dmarc`, ...) for UI keying. */
  key: string;
  type: "MX" | "TXT" | "CNAME" | "A";
  /** Fully-qualified record name. */
  name: string;
  value: string;
  /** MX only. */
  priority?: number;
  /** False for the convenience records mail delivery does not depend on. */
  required: boolean;
  /** Plain-language explanation of what breaks without it. */
  purpose: string;
  /** Absent until the record has been checked against live DNS. */
  status?: MailDnsRecordStatus;
}

/** How a domain on the mail server relates to the caller's organization. */
export type MailDomainOwnership =
  /** Assigned to an organization by an instance administrator. */
  | "CLAIMED"
  /**
   * On the mail server but assigned to no organization, so it reaches none of
   * them. Visible only to instance administrators, who assign it. Deliberately
   * not a pool orgs may claim from: since anyone can create an org and own it,
   * "whichever org looks first wins" left the shared mail server open to every
   * user on the instance.
   */
  | "UNCLAIMED";

/** One row of the Domains list: the mail server's view plus QQueue's claim. */
export interface MailDomainSummary {
  domain: string;
  ownership: MailDomainOwnership;
  active: boolean;
  description: string;
  /** Mailboxes defined on the server for this domain. */
  mailboxCount: number;
  /** 0 means Mailcow's own default applies. */
  maxMailboxes: number;
  defaultQuotaBytes: number;
  maxQuotaBytes: number;
  /** A relay/backup MX rather than a domain whose mail lands here. */
  backupmx: boolean;
  /** True once Mailcow holds a DKIM key for the domain. */
  hasDkim: boolean;
}

/** A domain's DNS picture: who hosts it and what still needs publishing. */
export interface MailDomainDnsStatus {
  domain: string;
  /** The host every record points at. */
  mailHost: string;
  provider: MailDnsProvider;
  nameservers: string[];
  records: MailDnsRecord[];
  /** True when every `required` record checked out as OK. */
  ready: boolean;
}

// Quota ceilings are sanity bounds, not policy: Mailcow enforces its own, and
// 0 means unlimited in every one of these fields.
const quotaMiB = z.number().int().min(0).max(10_000_000);

/**
 * A domain name, normalised to lowercase. Rejects a bare label, a URL and an
 * address so the value that reaches Mailcow is only ever a domain.
 */
export const mailDomainNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(253)
  .regex(
    /^(?!-)[a-z0-9-]{1,63}(?<!-)(?:\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
    "Enter a domain like example.com"
  );

export const mailDomainCreateSchema = z.object({
  organizationId: z.string().min(1),
  domain: mailDomainNameSchema,
  description: z.string().max(255).optional(),
  maxMailboxes: z.number().int().min(0).max(10_000).optional(),
  defaultQuotaMiB: quotaMiB.optional(),
  maxQuotaMiB: quotaMiB.optional(),
  totalQuotaMiB: quotaMiB.optional(),
  active: z.boolean().optional(),
  /**
   * Generate a DKIM key immediately. On by default: a domain without one sends
   * unsigned mail, and the whole point of showing DNS records at creation is
   * that the DKIM record is among them.
   */
  generateDkim: z.boolean().optional().default(true),
});

export type MailDomainCreateInput = z.infer<typeof mailDomainCreateSchema>;

/** Edit is create's attribute half; the domain name itself is immutable. */
export const mailDomainUpdateSchema = z.object({
  organizationId: z.string().min(1),
  domain: mailDomainNameSchema,
  description: z.string().max(255).optional(),
  maxMailboxes: z.number().int().min(0).max(10_000).optional(),
  defaultQuotaMiB: quotaMiB.optional(),
  maxQuotaMiB: quotaMiB.optional(),
  totalQuotaMiB: quotaMiB.optional(),
  active: z.boolean().optional(),
});

export type MailDomainUpdateInput = z.infer<typeof mailDomainUpdateSchema>;

/**
 * Deleting a domain destroys every mailbox and message under it, so the caller
 * must retype the domain name. The service also refuses while mailboxes exist.
 */
export const mailDomainDeleteSchema = z.object({
  organizationId: z.string().min(1),
  domain: mailDomainNameSchema,
  confirm: mailDomainNameSchema,
});

export type MailDomainDeleteInput = z.infer<typeof mailDomainDeleteSchema>;

/** What deleting a domain removed on each side. */
export interface MailDomainDeleteResult {
  domain: string;
  /** Sending accounts removed because their mailboxes no longer exist. */
  smtpConnectionsDeleted: number;
  /** Inbox accounts disabled — never deleted, that would cascade messages. */
  inboxAccountsDisabled: number;
}

/** Grants an ADMIN provisioning access to one Mailcow domain. */
export interface MailDomainGrant {
  id: string;
  organizationId: string;
  userId: string;
  domain: string;
  createdAt: string;
  user?: { id: string; email: string; name?: string | null };
}

export const mailDomainGrantCreateSchema = z.object({
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  domain: z.string().min(1),
});

export type MailDomainGrantCreateInput = z.infer<
  typeof mailDomainGrantCreateSchema
>;

/** Result of provisioning a mailbox; the password is shown exactly once. */
export interface MailboxProvisionResult {
  smtpConnection: SMTPConnection;
  inboxAccountId: string;
  email: string;
  /**
   * The human's mailbox login password (mail clients, SOGo). QQueue itself
   * keeps only an app password, encrypted — this is never retrievable again.
   */
  mailboxPassword: string;
  /**
   * Whether the SMTP credentials already verified end to end. False is a
   * warning, not a failure — Mailcow can take a moment to activate a fresh
   * mailbox; re-check with "Test connection" on the sending account.
   */
  verified: boolean;
}

/**
 * How a mailbox row relates to the two systems that can hold it.
 *
 * The Mailboxes page lists all three together, because "what addresses exist
 * on this domain" is one question — whether QQueue happens to hold credentials
 * for an address is an attribute of that address, not a different subject.
 */
export type MailboxOrigin =
  /** On the mail server *and* connected to QQueue — the provisioned case. */
  | "MANAGED"
  /** On the mail server but unknown to QQueue; adoptable. */
  | "SERVER_ONLY"
  /**
   * A QQueue sending account with no matching mailbox on the mail server:
   * added by hand, hosted elsewhere, or on a domain this caller may not
   * manage. Mail-server actions do not apply to it.
   */
  | "EXTERNAL";

/** One row of the Mailboxes list: the mail server and QQueue views, merged. */
export interface MailboxSummary {
  email: string;
  domain: string;
  /** Display name — the mail server's, falling back to the sending account's. */
  name: string;
  origin: MailboxOrigin;
  /** Mail-server active flag; null for EXTERNAL rows the server never saw. */
  active: boolean | null;
  /** Quota in bytes, 0 meaning unlimited. Null when the server didn't report. */
  quotaBytes: number | null;
  usedBytes: number | null;
  /** The sending account behind this address, when QQueue has one. */
  smtpConnectionId: string | null;
  /**
   * Default Reply-To on that sending account. Null for a SERVER_ONLY row:
   * there is no sending account to hold one until the mailbox is connected.
   */
  replyTo: string | null;
  /** SMTP host/port of that sending account, for the Server column. */
  host: string | null;
  port: number | null;
  isDefault: boolean;
}

export const emailAddressSchema = z.string().email();

/**
 * A default Reply-To address, or `""` to clear one that is already set.
 *
 * The empty string is part of the contract rather than an accident: a cleared
 * text input yields `""`, and with `.optional()` alone that would arrive as
 * `undefined` — indistinguishable from "field untouched", so the address would
 * survive the edit that meant to delete it. Services normalize `""` to NULL.
 */
export const replyToSchema = z.union([emailAddressSchema, z.literal("")]);

const mailboxTargetSchema = z.object({
  organizationId: z.string().min(1),
  email: z.string().email(),
});

export const mailboxPasswordResetSchema = mailboxTargetSchema;

export type MailboxPasswordResetInput = z.infer<
  typeof mailboxPasswordResetSchema
>;

/** A freshly rotated mailbox password, shown exactly once like provisioning's. */
export interface MailboxPasswordResetResult {
  email: string;
  mailboxPassword: string;
}

export const mailboxSetActiveSchema = mailboxTargetSchema.extend({
  active: z.boolean(),
});

export type MailboxSetActiveInput = z.infer<typeof mailboxSetActiveSchema>;

/** Connect an existing mail-server mailbox to QQueue for sending and sync. */
export const mailboxAdoptSchema = mailboxTargetSchema.extend({
  name: z.string().max(120).optional(),
  /** Default Reply-To for the sending account this creates. */
  replyTo: replyToSchema.optional(),
  /** Member to grant send-as on the adopted mailbox immediately. */
  assignToUserId: z.string().min(1).optional(),
});

export type MailboxAdoptInput = z.infer<typeof mailboxAdoptSchema>;

export interface MailboxAdoptResult {
  smtpConnection: SMTPConnection;
  inboxAccountId: string;
  email: string;
  /** Whether the app-password credentials already verified end to end. */
  verified: boolean;
}

/** What deleting a mail-server mailbox cleaned up on the QQueue side. */
export interface MailboxDeleteResult {
  email: string;
  /** The sending identity is meaningless without the mailbox, so it goes. */
  smtpConnectionDeleted: boolean;
  /**
   * The inbox account is *disabled*, not deleted: deleting it would cascade
   * away every message already synced from the mailbox.
   */
  inboxAccountDisabled: boolean;
}

/* -------------------------------------------------------------------------
 * Instance administration
 *
 * The install-scope view: every organization on the instance and the mail
 * infrastructure they share. Gated on `User.isInstanceAdmin`, which is a
 * different thing from org OWNER — anyone may create an org and own it.
 *
 * Deliberately the *infrastructure* layer only: orgs, members, domains,
 * mailboxes, sending accounts and send volume. Never message bodies, contacts
 * or campaign content. An instance administrator runs the server; that is not
 * the same as being entitled to read everyone's mail.
 * ---------------------------------------------------------------------- */

/** One organization as the instance sees it. */
export interface InstanceOrganizationSummary {
  id: string;
  name: string;
  memberCount: number;
  /** Mail domains assigned to this org. */
  domainCount: number;
  sendingAccountCount: number;
  createdAt: string;
  /** True when this admin has muted the org out of their own lists. */
  muted?: boolean;
}

/** One organization in full: members, what it holds, and how much it sends. */
export interface InstanceOrganizationDetail extends InstanceOrganizationSummary {
  members: {
    id: string;
    email: string;
    name?: string | null;
    role: UserRole;
    joinedAt: string;
  }[];
  domains: string[];
  sendingAccounts: {
    id: string;
    name: string;
    fromEmail: string;
    isDefault: boolean;
  }[];
  /** Send volume over the trailing 30 days. Counts only — never content. */
  stats: {
    sent: number;
    failed: number;
    bounced: number;
    suppressed: number;
  };
}

/** One org a domain has been assigned to. */
export interface MailDomainAssignee {
  id: string;
  name: string;
}

/** A domains-list row for the instance view: the server plus its assignment. */
export interface InstanceMailDomainSummary extends MailDomainSummary {
  /**
   * Every org this domain is assigned to, by name. Empty means it reaches
   * none — a domain is instance infrastructure until an administrator hands it
   * to someone, and it may be handed to more than one org at a time.
   */
  organizations: MailDomainAssignee[];
  muted?: boolean;
}

/** Every mailbox on the server, with the orgs that hold its domain. */
export interface InstanceMailboxSummary {
  email: string;
  domain: string;
  name: string;
  active: boolean;
  quotaBytes: number;
  usedBytes: number;
  organizations: MailDomainAssignee[];
  /** True when QQueue holds a sending account for it, not just the server. */
  connected: boolean;
}

/**
 * Create a domain on the mail server. `organizationIds` may be empty: an
 * administrator may stand a domain up before deciding who gets it, which is
 * safe now that an unassigned domain reaches nobody.
 */
export const instanceMailDomainCreateSchema = z.object({
  domain: mailDomainNameSchema,
  organizationIds: z.array(z.string().min(1)).optional(),
  description: z.string().max(255).optional(),
  maxMailboxes: z.number().int().min(0).max(10_000).optional(),
  defaultQuotaMiB: quotaMiB.optional(),
  maxQuotaMiB: quotaMiB.optional(),
  totalQuotaMiB: quotaMiB.optional(),
  active: z.boolean().optional(),
  generateDkim: z.boolean().optional().default(true),
});

export type InstanceMailDomainCreateInput = z.infer<
  typeof instanceMailDomainCreateSchema
>;

/** Edit is create's attribute half; the domain name itself is immutable. */
export const instanceMailDomainUpdateSchema = z.object({
  domain: mailDomainNameSchema,
  description: z.string().max(255).optional(),
  maxMailboxes: z.number().int().min(0).max(10_000).optional(),
  defaultQuotaMiB: quotaMiB.optional(),
  maxQuotaMiB: quotaMiB.optional(),
  totalQuotaMiB: quotaMiB.optional(),
  active: z.boolean().optional(),
});

export type InstanceMailDomainUpdateInput = z.infer<
  typeof instanceMailDomainUpdateSchema
>;

/** Deleting destroys every mailbox under the domain, so retype the name. */
export const instanceMailDomainDeleteSchema = z.object({
  domain: mailDomainNameSchema,
  confirm: mailDomainNameSchema,
});

export type InstanceMailDomainDeleteInput = z.infer<
  typeof instanceMailDomainDeleteSchema
>;

/**
 * Assign a domain to an organization, or hand it back to the instance.
 *
 * `null` unassigns. This replaces the old self-serve claim: an org used to be
 * able to take any unclaimed domain for itself, which is not an access control
 * when anyone can create an org.
 */
/**
 * Which orgs reach a domain, as the complete desired set rather than a delta.
 *
 * A checkbox list submits the whole set, and replace semantics make the write
 * idempotent and let one call both add and remove — a delta API would need two
 * round trips to express "these three, not those two", and could interleave
 * badly with another administrator editing the same domain.
 *
 * An empty array hands the domain back to the instance: it then reaches no org
 * at all, which is the state a freshly created domain starts in.
 */
export const mailDomainAssignSchema = z.object({
  organizationIds: z.array(z.string().min(1)),
});

export type MailDomainAssignInput = z.infer<typeof mailDomainAssignSchema>;

/** Grant one user provisioning access to one domain, within their org. */
export const instanceMailDomainGrantCreateSchema = z.object({
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  domain: z.string().min(1),
});

export type InstanceMailDomainGrantCreateInput = z.infer<
  typeof instanceMailDomainGrantCreateSchema
>;

/** What an instance administrator can mute out of their own lists. */
export type InstanceMuteScope = "ORG" | "DOMAIN";

/**
 * A personal, cosmetic view filter.
 *
 * Hides an org or domain from *this* administrator's own instance-wide lists
 * and nothing more. It never changes what anyone can reach — that is
 * `OrgMailDomain` (assignment) and `MailDomainGrant` (delegation). Keeping the
 * two apart is the whole point: a filter that quietly revoked access, or an
 * access control that looked like a filter, would both be traps.
 */
export interface InstanceAdminMute {
  id: string;
  scope: InstanceMuteScope;
  /** Organization id, or lowercase domain name. */
  target: string;
  createdAt: string;
}

export const instanceMuteCreateSchema = z.object({
  scope: z.enum(["ORG", "DOMAIN"]),
  target: z.string().min(1),
});

export type InstanceMuteCreateInput = z.infer<typeof instanceMuteCreateSchema>;

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

/**
 * How an organization's outbound mail looks.
 *
 * Every field is nullable and every one is opt-in: null means "add nothing",
 * not "not configured yet". The render layer draws no header without a brand
 * name or logo and no small print without a note, so a self-hosted install
 * never stamps a vendor name onto mail its owner did not ask for. Empty strings
 * are normalised to null so clearing a field in the UI reaches that same state.
 */
const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

export const organizationBrandingSchema = z.object({
  brandName: z.preprocess(emptyToNull, z.string().trim().max(100).nullable()),
  /**
   * Absolute http(s) only. A mail client has no session and no page to resolve
   * a relative path against, so a relative URL is a broken image by the time it
   * matters. In practice this is an /api/v1/images/:publicId URL.
   */
  logoUrl: z.preprocess(
    emptyToNull,
    z
      .string()
      .url()
      .refine((value) => /^https?:\/\//i.test(value), {
        message: "Logo URL must be absolute (http or https)"
      })
      .nullable()
  ),
  /** A six-digit hex colour; anything looser reaches the email as broken CSS. */
  accentColor: z.preprocess(
    emptyToNull,
    z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex colour, e.g. #2E7D63")
      .nullable()
  ),
  footerNote: z.preprocess(emptyToNull, z.string().trim().max(500).nullable()),
  /**
   * Whether the frame (header, accent, email-safe layout) is drawn around
   * outgoing mail at all. The address and unsubscribe link ignore this: they are
   * obligations on bulk mail, not styling.
   */
  brandingEnabled: z.boolean()
});

export type OrganizationBrandingInput = z.infer<
  typeof organizationBrandingSchema
>;

// Org membership roles. Mirrors the Prisma `UserRole` enum and the `UserRole`
// union above; kept as a Zod enum so request bodies validate against it.
export const userRoleSchema = z.enum(["OWNER", "ADMIN", "MEMBER"]);

// Changing an existing member's role. OWNER-related guards (last-owner, who may
// grant OWNER) live in the service, not the schema.
export const memberRoleUpdateSchema = z.object({
  role: userRoleSchema,
});

export type MemberRoleUpdateInput = z.infer<typeof memberRoleUpdateSchema>;

export type InviteStatus = "PENDING" | "ACCEPTED" | "REVOKED";

// Create an invitation to join an organization. The role defaults to MEMBER;
// inviting someone as OWNER is allowed by the schema but gated to OWNERs in the
// service (an ADMIN cannot mint a new OWNER).
export const inviteCreateSchema = z.object({
  organizationId: z.string().min(1),
  email: emailAddressSchema,
  role: userRoleSchema.default("MEMBER"),
});

export type InviteCreateInput = z.infer<typeof inviteCreateSchema>;

// Accept an invitation via its emailed token. `password`/`name` are only used
// when the invited email has no account yet (a new user is created); the
// service requires a password in that case and ignores these otherwise.
export const inviteAcceptSchema = z.object({
  token: z.string().min(16),
  password: z.string().min(8).optional(),
  name: z.string().optional(),
});

export type InviteAcceptInput = z.infer<typeof inviteAcceptSchema>;

// Instance-wide settings (first-run onboarding). Sparse key-value rows in the
// InstanceSetting table; an absent key falls back to the env/default value.
export const INSTANCE_SETTING_KEYS = {
  allowPublicRegistration: "allowPublicRegistration",
  setupCompletedAt: "setupCompletedAt",
} as const;

// Body for POST /setup/complete: the wizard's final registration-policy choice.
export const setupCompleteSchema = z.object({
  allowPublicRegistration: z.boolean(),
});

export type SetupCompleteInput = z.infer<typeof setupCompleteSchema>;

export const instanceSettingsUpdateSchema = z.object({
  allowPublicRegistration: z.boolean().optional(),
});

export type InstanceSettingsUpdateInput = z.infer<
  typeof instanceSettingsUpdateSchema
>;

// Public first-run probe consumed by the web app's SetupGate and Login page.
export interface SetupStatus {
  needsSetup: boolean;
  setupCompleted: boolean;
  allowPublicRegistration: boolean;
}

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
//
// A target list can be named two ways: `contactListId` for an existing list, or
// `contactListName` to create one as part of the import. They are mutually
// exclusive — passing both is a validation error rather than a silent
// precedence rule, so the caller's intent is never guessed at.
// How an imported row is applied when a contact with that email already exists
// in the organization. Applies to duplicates only — a row with no existing match
// is always created.
//
// MERGE is the default and the historical behaviour: fill in names the contact
// is missing and union the tags, so an import can never destroy data the CSV
// simply didn't carry. REPLACE is the opt-in destructive one.
//
// No resolution touches `status`: an import must never reactivate a bounced or
// unsubscribed contact, which is a suppression-integrity rule rather than a
// merge preference.
export const contactImportResolutionSchema = z.enum([
  /** Fill blank names, union tags. */
  "MERGE",
  /** Overwrite names and tags with the CSV values. */
  "REPLACE",
  /** Leave the contact untouched, but still add it to the target list. */
  "KEEP",
  /** Leave the contact untouched and exclude it from the import entirely. */
  "SKIP",
]);

export type ContactImportResolution = z.infer<
  typeof contactImportResolutionSchema
>;

// Per-email instruction from the import review screen: how to resolve this
// duplicate, and optionally corrected field values the user edited in place.
// Edited values replace what the CSV carried before the resolution is applied.
export const contactImportOverrideSchema = z.object({
  resolution: contactImportResolutionSchema.optional(),
  firstName: z.string().max(200).optional(),
  lastName: z.string().max(200).optional(),
  tags: z.array(z.string().min(1).max(64)).max(50).optional(),
});

export type ContactImportOverride = z.infer<typeof contactImportOverrideSchema>;

// CSV import options. The CSV payload itself is handled by the upload middleware,
// not validated here; this only carries the optional target list and the
// duplicate-resolution choices made on the review screen.
//
// A target list can be named two ways: `contactListId` for an existing list, or
// `contactListName` to create one as part of the import. They are mutually
// exclusive — passing both is a validation error rather than a silent
// precedence rule, so the caller's intent is never guessed at.
//
// `overrides` is keyed by lower-cased email and is expected to be sparse: the
// review screen sends only the rows the user decided individually, with
// `defaultResolution` covering the rest. The client re-uploads the CSV alongside
// it rather than the server holding parsed rows between the two calls, which
// keeps the import stateless at any file size.
export const csvImportSchema = z
  .object({
    organizationId: z.string().min(1),
    contactListId: z.string().min(1).optional(),
    contactListName: z.string().min(1).max(200).optional(),
    defaultResolution: contactImportResolutionSchema.optional(),
    overrides: z.record(z.string(), contactImportOverrideSchema).optional(),
  })
  .refine(
    (value) => !(value.contactListId && value.contactListName),
    {
      message: "Provide either contactListId or contactListName, not both",
      path: ["contactListName"],
    },
  );

export type CsvImportInput = z.infer<typeof csvImportSchema>;

// Dry-run of an import: same parse and same duplicate detection as the real
// thing, but nothing is written. Takes the target list so the preview can report
// whether the list would be created.
export const csvImportPreviewSchema = z
  .object({
    organizationId: z.string().min(1),
    contactListId: z.string().min(1).optional(),
    contactListName: z.string().min(1).max(200).optional(),
  })
  .refine(
    (value) => !(value.contactListId && value.contactListName),
    {
      message: "Provide either contactListId or contactListName, not both",
      path: ["contactListName"],
    },
  );

export type CsvImportPreviewInput = z.infer<typeof csvImportPreviewSchema>;

// Bulk contact deletion. Capped so a single request can't take out an entire
// table in one transaction; the UI pages through larger selections.
export const contactBulkDeleteSchema = z.object({
  organizationId: z.string().min(1),
  contactIds: z.array(z.string().min(1)).min(1).max(1000),
});

export type ContactBulkDeleteInput = z.infer<typeof contactBulkDeleteSchema>;

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
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type InboundMessageQueryInput = z.infer<
  typeof inboundMessageQuerySchema
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

export const templateVariableSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(
      /^[\w.-]+$/,
      "Variable names may only contain letters, numbers, dots, hyphens, and underscores"
    ),
  label: z.string().optional().nullable(),
  defaultValue: z.string().optional().nullable(),
  required: z.boolean().optional(),
});

export const templateSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  tags: z.array(z.string().min(1)).optional(),
  subject: z.string().min(1),
  html: z.string().min(1),
  mjml: z.string().optional().nullable(),
  text: z.string().optional().nullable(),
  variables: z.array(templateVariableSchema).optional().nullable(),
  previewData: z.record(z.string()).optional().nullable(),
});

export type TemplateInput = z.infer<typeof templateSchema>;
export type TemplateVariableInput = z.infer<typeof templateVariableSchema>;

/**
 * Render a template (subject + body) with sample/real data, returning
 * email-safe HTML. `tracking` is opt-in so dashboard previews don't rewrite
 * links into click-tracking URLs.
 */
export const templatePreviewSchema = z.object({
  organizationId: z.string().min(1),
  subject: z.string().optional(),
  html: z.string().optional(),
  text: z.string().optional().nullable(),
  variables: z.array(templateVariableSchema).optional().nullable(),
  /** Sample values keyed by variable name. */
  data: z.record(z.string()).optional(),
  /** When omitted, the saved template (by id) supplies subject/html. */
  templateId: z.string().optional(),
});

export type TemplatePreviewInput = z.infer<typeof templatePreviewSchema>;

export interface TemplatePreviewResult {
  subject: string;
  html: string;
}

export const templateTestSendSchema = z.object({
  organizationId: z.string().min(1),
  /** Recipient for the test; defaults to the authenticated user server-side. */
  to: emailAddressSchema.optional(),
  /** Sample values keyed by variable name. */
  data: z.record(z.string()).optional(),
  smtpConnectionId: z.string().optional(),
});

export type TemplateTestSendInput = z.infer<typeof templateTestSendSchema>;

// Matches `{{ variableName }}` with optional surrounding whitespace; the name
// may contain letters, numbers, dots, hyphens, and underscores.
const VARIABLE_TOKEN = /\{\{\s*([\w.-]+)\s*\}\}/g;

/**
 * Collect the distinct variable names referenced as `{{name}}` across the given
 * strings, preserving first-seen order. Browser-safe (no `node:*`). Used by both
 * the dashboard variables panel and the API to reconcile declared vs. used vars.
 */
export function extractVariables(...sources: Array<string | null | undefined>) {
  const seen = new Set<string>();
  for (const source of sources) {
    if (!source) {
      continue;
    }
    for (const match of source.matchAll(VARIABLE_TOKEN)) {
      seen.add(match[1]);
    }
  }
  return [...seen];
}

/**
 * Substitute `{{name}}` tokens with values from `data`. Unknown/empty values
 * render as an empty string. This is the single substitution implementation
 * shared by previews and the send pipeline.
 */
export function applyVariables(
  value: string | null | undefined,
  data: Record<string, unknown> | undefined
): string {
  if (!value) {
    return "";
  }
  if (!data) {
    return value;
  }
  return value.replace(VARIABLE_TOKEN, (_match, key: string) => {
    const variable = data[key];
    return variable === undefined || variable === null ? "" : String(variable);
  });
}

/**
 * Build the effective substitution map for a render: declared variable defaults
 * first, then caller-supplied data overrides. Empty/blank overrides fall back to
 * the default so a half-filled preview still shows sensible placeholder text.
 */
export function resolveVariableData(
  variables: TemplateVariable[] | null | undefined,
  data: Record<string, string> | undefined
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const variable of variables ?? []) {
    if (variable.defaultValue != null && variable.defaultValue !== "") {
      resolved[variable.name] = variable.defaultValue;
    }
  }
  for (const [key, val] of Object.entries(data ?? {})) {
    if (val !== "" && val != null) {
      resolved[key] = val;
    }
  }
  return resolved;
}

/** Built-in starter templates offered in the "New template" gallery. */
export interface StarterTemplate {
  key: string;
  name: string;
  description: string;
  category: string;
  subject: string;
  html: string;
  variables: TemplateVariable[];
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    key: "blank",
    name: "Blank",
    description: "Start from an empty canvas.",
    category: "Basic",
    subject: "",
    html: "<p></p>",
    variables: [],
  },
  {
    key: "welcome",
    name: "Welcome",
    description: "Greet a new user and point them to a first action.",
    category: "Onboarding",
    subject: "Welcome to {{company}}, {{firstName}}!",
    html: [
      "<h1>Welcome aboard, {{firstName}} 👋</h1>",
      "<p>We're thrilled to have you at {{company}}. Your account is ready to go.</p>",
      "<p>To get the most out of it, start by setting up your first project.</p>",
      '<p><a href="{{ctaUrl}}">Get started</a></p>',
      "<p>If you have any questions, just reply to this email — we're here to help.</p>",
      "<p>— The {{company}} team</p>",
    ].join("\n"),
    variables: [
      { name: "firstName", label: "First name", defaultValue: "there" },
      { name: "company", label: "Company", defaultValue: "QQueue" },
      {
        name: "ctaUrl",
        label: "Call-to-action URL",
        defaultValue: "https://example.com/start",
      },
    ],
  },
  {
    key: "newsletter",
    name: "Newsletter",
    description: "A simple update with a heading, body, and sign-off.",
    category: "Newsletter",
    subject: "{{company}} news — {{month}}",
    html: [
      "<h1>What's new at {{company}}</h1>",
      "<p>Hi {{firstName}}, here's the latest from us this month.</p>",
      "<h2>Highlight of the month</h2>",
      "<p>Share your most important update here. Keep it short and skimmable.</p>",
      '<p><a href="{{ctaUrl}}">Read more</a></p>',
      "<hr />",
      "<p>Thanks for reading,<br />The {{company}} team</p>",
    ].join("\n"),
    variables: [
      { name: "firstName", label: "First name", defaultValue: "there" },
      { name: "company", label: "Company", defaultValue: "QQueue" },
      { name: "month", label: "Month", defaultValue: "this month" },
      {
        name: "ctaUrl",
        label: "Call-to-action URL",
        defaultValue: "https://example.com",
      },
    ],
  },
  {
    key: "password-reset",
    name: "Password reset",
    description: "Transactional reset link with a clear call to action.",
    category: "Transactional",
    subject: "Reset your {{company}} password",
    html: [
      "<h1>Reset your password</h1>",
      "<p>Hi {{firstName}}, we received a request to reset your password.</p>",
      '<p><a href="{{resetUrl}}">Choose a new password</a></p>',
      "<p>This link expires in 30 minutes. If you didn't request a reset, you can safely ignore this email.</p>",
      "<p>— The {{company}} team</p>",
    ].join("\n"),
    variables: [
      { name: "firstName", label: "First name", defaultValue: "there" },
      { name: "company", label: "Company", defaultValue: "QQueue" },
      {
        name: "resetUrl",
        label: "Reset URL",
        defaultValue: "https://example.com/reset",
        required: true,
      },
    ],
  },
  {
    key: "announcement",
    name: "Announcement",
    description: "Launch or feature announcement with a prominent button.",
    category: "Marketing",
    subject: "Introducing {{feature}}",
    html: [
      "<h1>Say hello to {{feature}}</h1>",
      "<p>Hi {{firstName}}, we just shipped something we think you'll love.</p>",
      "<p>Describe what's new and why it matters in a sentence or two.</p>",
      '<p><a href="{{ctaUrl}}">Try it now</a></p>',
      "<p>— The {{company}} team</p>",
    ].join("\n"),
    variables: [
      { name: "firstName", label: "First name", defaultValue: "there" },
      { name: "company", label: "Company", defaultValue: "QQueue" },
      { name: "feature", label: "Feature name", defaultValue: "our new feature" },
      {
        name: "ctaUrl",
        label: "Call-to-action URL",
        defaultValue: "https://example.com",
      },
    ],
  },
];

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

// Phase D — deliverability tooling. A time-windowed view over the send funnel.
// `from`/`to` are ISO datetimes; the service defaults to the last 30 days when
// omitted.
export const deliverabilityQuerySchema = z.object({
  organizationId: z.string().min(1),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type DeliverabilityQueryInput = z.infer<
  typeof deliverabilityQuerySchema
>;

// ---------------------------------------------------------------------------
// Deliverability reporting contract, shared by apps/api and apps/web.
//
// The funnel is counted from EmailJob rows — exactly one per recipient, each
// carrying a terminal status — and never from EmailEvent totals. Events are
// many-per-recipient (one address can produce a synchronous SMTP rejection, a
// later DSN, and an ESP webhook for the same send), they arrive well after the
// attempt, and for some signals they never arrive at all. Counting them gives a
// numerator and a denominator that describe different populations: an SMTP
// rejection writes BOUNCED and no SENT, so 50 rejections out of 100 attempts
// once rendered as a 100% bounce rate. Jobs don't have that failure mode.
// ---------------------------------------------------------------------------

/**
 * Whether this organization has ever received delivery confirmation from a
 * source that actually observes delivery: an ESP webhook, or an RFC 3464 DSN
 * reporting a `delivered`/`relayed` action.
 *
 * A successful SMTP handoff proves the next hop accepted the message, not that
 * it reached a mailbox — so an install with neither source has *no* delivery
 * signal, and must be shown that fact rather than a percentage. Notably, an
 * open is not a delivery source: deriving delivery from the tracking pixel
 * silently reports the open rate under a delivery label.
 */
export type DeliverySignal = "none" | "confirmed";

export interface DeliverabilityOverview {
  window: { from: string; to: string };
  deliverySignal: DeliverySignal;
  totals: {
    /**
     * Reached a recipient's mail server: SENT, plus the FAILED jobs whose
     * failure was a bounce. The denominator for every reputation rate.
     *
     * Deliberately not `SENT + FAILED`. `FAILED` conflates two unrelated
     * things: a receiving server rejecting the recipient (a reputation
     * signal) and our own send throwing before handoff — SMTP down, auth
     * refused, TLS failure, a template that would not render (not a
     * reputation signal, because no recipient server ever saw the message).
     * Counting the second kind inflates this denominator and *deflates*
     * bounce and complaint rates: an outage that fails half a 100-recipient
     * send turns a true 10% bounce rate into a reported 5.0%, which lands
     * just under `BOUNCE_RATE_ALERT` and silently withholds the alert.
     */
    attempted: number;
    sent: number;
    /** Every terminal failure, both kinds. `attempted` excludes the second. */
    failed: number;
    /**
     * The FAILED jobs that never reached a recipient's mail server. An ops
     * number, not a reputation one — surfaced so the population excluded
     * from `attempted` stays visible instead of silently vanishing.
     */
    failedBeforeHandoff: number;
    /** Never attempted — on the suppression list, or cancelled before send. */
    suppressedAtSend: number;
    cancelled: number;
    /** Still in flight at query time (PENDING/QUEUED/PROCESSING). */
    inFlight: number;
    confirmedDelivered: number;
    /**
     * Distinct jobs, not events. A recipient that bounced soft and then hard
     * counts once here and in both class buckets below, so the three classes
     * can sum to more than `bounced`.
     */
    bounced: number;
    hardBounced: number;
    softBounced: number;
    blockBounced: number;
    complained: number;
    opened: number;
    clicked: number;
    /** Suppression-list growth in the window, and the list's total size. */
    suppressedInWindow: number;
    suppressedTotal: number;
  };
  /**
   * `null` means the denominator was zero, or (for `confirmedDelivery`) that
   * no delivery signal exists. Render it as "—"; rendering it as 0% claims a
   * measurement that was never taken.
   */
  rates: {
    accepted: number | null;
    confirmedDelivery: number | null;
    bounce: number | null;
    complaint: number | null;
    open: number | null;
    click: number | null;
    /**
     * Share of terminal jobs that never got out of the door, over `SENT +
     * FAILED`. The one rate here whose denominator is *not* `attempted` — it
     * measures the sending setup, not the reputation, and a value above zero
     * means the reputation rates are describing a smaller send than intended.
     */
    deliveryFailure: number | null;
  };
}

export interface DeliverabilityDomainRow {
  domain: string;
  /** Same definition as the overview's: SENT + FAILED-with-a-bounce. */
  attempted: number;
  sent: number;
  /**
   * FAILED without a bounce, for this domain. Kept as its own column rather
   * than folded into `attempted` so a domain whose sends *all* died before
   * handoff still appears in the table — under the old `SENT + FAILED`
   * denominator it showed a reassuring 0.0% bounce rate, and under a naive
   * fix it would have disappeared from the list entirely.
   */
  failedBeforeHandoff: number;
  bounced: number;
  complained: number;
  bounceRate: number | null;
  complaintRate: number | null;
}

export interface DeliverabilityDomains {
  domains: DeliverabilityDomainRow[];
}

export interface ReputationAlert {
  level: "warning" | "critical";
  metric: "bounceRate" | "complaintRate";
  value: number;
  threshold: number;
  message: string;
}

/** The industry red lines that get a sender throttled or blocklisted. */
export const BOUNCE_RATE_ALERT = 0.05;
export const COMPLAINT_RATE_ALERT = 0.001;

/**
 * Below this many attempts the rates are noise — three bounces out of five
 * sends is 60%, and alerting on it trains people to ignore the banner.
 */
export const MIN_ATTEMPTS_FOR_ALERT = 50;

/**
 * Reputation alerts, derived purely from an overview. Pure so both sides can
 * run it: the API serves it at `/deliverability/alerts` for external consumers,
 * and the dashboard derives it from the overview it already fetched instead of
 * paying for a second full aggregation.
 */
export function deriveReputationAlerts(
  overview: DeliverabilityOverview,
): ReputationAlert[] {
  const alerts: ReputationAlert[] = [];
  if (overview.totals.attempted < MIN_ATTEMPTS_FOR_ALERT) {
    return alerts;
  }

  const { bounce, complaint } = overview.rates;
  if (bounce !== null && bounce > BOUNCE_RATE_ALERT) {
    alerts.push({
      level: "critical",
      metric: "bounceRate",
      value: bounce,
      threshold: BOUNCE_RATE_ALERT,
      message:
        "Bounce rate is above 5%. Clean your list and verify addresses to protect sender reputation.",
    });
  }
  if (complaint !== null && complaint > COMPLAINT_RATE_ALERT) {
    alerts.push({
      level: "critical",
      metric: "complaintRate",
      value: complaint,
      threshold: COMPLAINT_RATE_ALERT,
      message:
        "Complaint rate is above 0.1%. Review targeting and unsubscribe handling.",
    });
  }
  return alerts;
}

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

/**
 * Caps for inline attachments carried on the send body itself. Inline
 * attachments exist for small per-message assets built at send time — a
 * ticket QR, a barcode, a tiny logo — where a separate upload round-trip
 * (POST /attachments needs a dashboard session, not an API key) would be
 * disproportionate. Anything bigger belongs in `attachmentIds`, whose blobs
 * are uploaded ahead of time and capped by ATTACHMENT_MAX_BYTES instead.
 *
 * 256 KB × 10 decodes to 2.5 MB — ~3.4 MB as base64 — which the API's 4 MB
 * JSON body limit accommodates with room for the HTML; the limits move
 * together.
 */
export const INLINE_ATTACHMENT_MAX_BYTES = 262_144;
export const MAX_INLINE_ATTACHMENTS = 10;

// Strict base64: no whitespace or URL-safe alphabet, correct padding. Being
// strict makes the decoded size below exact, so the byte cap is enforceable
// here in the browser-safe schema without Buffer.
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/** Exact decoded byte length of a strict, padded base64 string. */
export function base64DecodedBytes(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export const inlineAttachmentSchema = z.object({
  filename: z.string().min(1).max(200),
  contentBase64: z
    .string()
    .min(1)
    .refine((v) => v.length % 4 === 0 && BASE64_PATTERN.test(v), {
      message: "contentBase64 must be strict, padded base64"
    })
    .refine((v) => base64DecodedBytes(v) <= INLINE_ATTACHMENT_MAX_BYTES, {
      message: `Inline attachments are capped at ${INLINE_ATTACHMENT_MAX_BYTES} bytes; upload larger files via POST /attachments`
    }),
  contentType: z.string().min(1).max(200).optional(),
  // Content-ID for inline display: HTML referencing `cid:<cid>` renders the
  // attachment in place (and mail clients show it even with remote images
  // blocked). Omit it for a regular downloadable attachment.
  cid: z
    .string()
    .regex(/^[^\s<>]{1,200}$/, {
      message: "cid must contain no whitespace or angle brackets"
    })
    .optional()
});

export type InlineAttachmentInput = z.infer<typeof inlineAttachmentSchema>;

export const sendEmailSchema = z.object({
  organizationId: z.string().min(1),
  to: emailAddressSchema,
  cc: z.array(emailAddressSchema).optional(),
  bcc: z.array(emailAddressSchema).optional(),
  replyTo: emailAddressSchema.optional(),
  // Sender selectors. Both are optional and resolve to the same thing: an
  // SMTPConnection, which is where the From header is built from. Pass
  // `smtpConnectionId` to name one exactly, or `from` to name one by the
  // address it sends as; the id wins if a caller supplies both. Neither means
  // the org default. `from` is a lookup key, not a header value — an address
  // no sending account uses is a 404, never a hand-built From.
  from: emailAddressSchema.optional(),
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
  // Small attachments carried on the send body itself (base64), optionally
  // inline via `cid`. Stored to the same object storage and delivered through
  // the same worker path as uploaded attachments — only the way in differs.
  attachments: z
    .array(inlineAttachmentSchema)
    .max(MAX_INLINE_ATTACHMENTS)
    .optional(),
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

// A composed message that repeats on a cron schedule. Same shape as a manual
// send minus the one-shot/attachment bits, plus the recurrence itself.
//
// `scheduledAt` has no meaning here (the cron owns the timing) and attachments
// are unsupported because an EmailAttachment row is claimed by a single
// EmailJob and cannot be reused across occurrences.
export const recurringSendCreateSchema = z
  .object({
    organizationId: z.string().min(1),
    name: z.string().min(1).max(200),
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
    cronExpression: cronExpressionSchema,
    timezone: timezoneSchema,
  })
  .refine(
    (input) =>
      (input.to?.length ?? 0) +
        (input.contactIds?.length ?? 0) +
        (input.listIds?.length ?? 0) >
      0,
    { message: "At least one recipient is required", path: ["to"] },
  )
  .refine((input) => Boolean(input.html || input.text), {
    message: "Provide an email body",
    path: ["html"],
  });

export type RecurringSendCreateInput = z.infer<
  typeof recurringSendCreateSchema
>;

export const recurringSendUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  cronExpression: cronExpressionSchema.optional(),
  timezone: timezoneSchema.optional(),
});

export type RecurringSendUpdateInput = z.infer<
  typeof recurringSendUpdateSchema
>;

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
  | "failed"
  | "suppressed";

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

// Autocomplete entry for the composer's To/Cc/Bcc fields. `source` distinguishes
// a saved contact from an address that only shows up in past sends, so the UI
// can label the two differently.
export interface RecipientSuggestion {
  email: string;
  name?: string | null;
  source: "contact" | "recent";
}

// A message that has been accepted but not yet delivered: the user-facing view
// of the send queue. Unlike the queue-operations dashboard (raw BullMQ jobs),
// this is addressed by EmailJob id and speaks in subjects and addresses.
export interface OutboxEmail {
  id: string;
  subject: string;
  to: string[];
  ccCount: number;
  bccCount: number;
  status: EmailJobStatus;
  origin: EmailOrigin;
  scheduledAt?: string | null;
  createdAt: string;
  campaignName?: string | null;
  sendingAccount?: {
    name: string;
    fromEmail: string;
    fromName?: string | null;
  } | null;
}

/*
  The sent archive — the other half of the outbox.

  Where the outbox is a live view of what has not left yet, this is everything
  that has: mail the pipeline finished with, whatever the outcome. It is the one
  view in the app that can grow without bound (an org that sends a campaign a
  week accumulates six figures of rows), so unlike every other list it filters,
  sorts and pages **on the server**. Nothing here loads the whole table.
*/

// What happened to a sent email, as one axis rather than two. `failed` is the
// job's own status; the rest are EmailEvent rows the pipeline wrote after the
// message left, so they answer "did it land, and did anyone read it".
export const SENT_EMAIL_OUTCOMES = [
  "all",
  "delivered",
  "opened",
  "clicked",
  "bounced",
  "complained",
  "failed"
] as const;

export type SentEmailOutcome = (typeof SENT_EMAIL_OUTCOMES)[number];

export const sentEmailQuerySchema = z.object({
  organizationId: z.string().min(1),
  /** Matches subject, recipient address, or campaign name. */
  q: z.string().trim().min(1).optional(),
  origin: z
    .enum(["all", "CAMPAIGN", "TRANSACTIONAL", "MANUAL", "SYSTEM"])
    .default("all"),
  outcome: z.enum(SENT_EMAIL_OUTCOMES).default("all"),
  /** Narrow to one sending account (the UI calls these "sending accounts"). */
  smtpConnectionId: z.string().min(1).optional(),
  /** Rolling window in days back from now. 0 means all time. */
  days: z.coerce.number().int().min(0).max(365).default(0),
  page: z.coerce.number().int().min(1).default(1),
  // Capped at 100: this is the one endpoint someone could ask for the whole
  // archive from, and a page is rendered as DOM rows either way.
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
});

export type SentEmailQueryInput = z.infer<typeof sentEmailQuerySchema>;

// One row of the archive. The engagement fields are folded down from this job's
// EmailEvent rows so a list of 25 emails is one query, not 25.
export interface SentEmail {
  id: string;
  subject: string;
  to: string[];
  ccCount: number;
  bccCount: number;
  /** Only ever SENT or FAILED — the archive holds terminal outcomes. */
  status: EmailJobStatus;
  origin: EmailOrigin;
  /** Null for a job that failed before the provider accepted it. */
  sentAt?: string | null;
  createdAt: string;
  campaignId?: string | null;
  campaignName?: string | null;
  sendingAccount?: {
    name: string;
    fromEmail: string;
    fromName?: string | null;
  } | null;
  delivered: boolean;
  bounced: boolean;
  complained: boolean;
  opens: number;
  clicks: number;
}

export interface SentEmailPage {
  rows: SentEmail[];
  /** Total matching the current filters, not the org's lifetime total. */
  total: number;
  page: number;
  pageSize: number;
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
  replyTo: replyToSchema.optional(),
  isDefault: z.boolean().optional(),
});

export type SMTPConnectionInput = z.infer<typeof smtpConnectionSchema>;

export const smtpConnectionUpdateSchema = smtpConnectionSchema.partial();

export type SMTPConnectionUpdateInput = z.infer<
  typeof smtpConnectionUpdateSchema
>;

// The local part is validated conservatively (dot-atom without quoting);
// Mailcow enforces its own rules on top.
export const mailboxProvisionSchema = z.object({
  organizationId: z.string().min(1),
  localPart: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?$/i,
      "Use letters, numbers, dots, dashes, plus or underscores"
    ),
  domain: z.string().min(1),
  name: z.string().max(120).optional(),
  /** Default Reply-To for the sending account this creates. */
  replyTo: replyToSchema.optional(),
  /** Member to grant send-as on the new mailbox immediately. */
  assignToUserId: z.string().min(1).optional(),
});

export type MailboxProvisionInput = z.infer<typeof mailboxProvisionSchema>;

export const smtpConnectionGrantCreateSchema = z.object({
  userId: z.string().min(1),
});

export type SmtpConnectionGrantCreateInput = z.infer<
  typeof smtpConnectionGrantCreateSchema
>;

/**
 * A browser's Web Push registration, in the shape `PushSubscription.toJSON()`
 * produces — so the dashboard can post the subscription through unchanged.
 * `p256dh` and `auth` are the client's own public keys; they are not secrets of
 * ours and are useless without the private key held on the device.
 */
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  /** Best-effort device label shown in settings; never trusted for anything. */
  userAgent: z.string().max(512).optional(),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

export type PushUnsubscribeInput = z.infer<typeof pushUnsubscribeSchema>;

/**
 * A browser rotating a subscription out from under us, replayed by the service
 * worker. `oldEndpoint` is the authorization: it is an unguessable URL the push
 * service issued to this client alone, which is the only credential a service
 * worker has — it cannot read the bearer token, since that lives in
 * localStorage and workers have no access to it.
 */
export const pushRotateSchema = z.object({
  oldEndpoint: z.string().url(),
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  userAgent: z.string().max(512).optional(),
});

export type PushRotateInput = z.infer<typeof pushRotateSchema>;

/**
 * How much of one organization's incoming mail may notify a member's devices.
 * Mirrors the `InboxNotifyLevel` enum in the Prisma schema.
 */
export const inboxNotifyLevelSchema = z.enum([
  "ALL",
  "ADDRESSED_TO_ME",
  "NONE",
]);

export type InboxNotifyLevel = z.infer<typeof inboxNotifyLevelSchema>;

export const inboxNotifyPreferenceUpdateSchema = z.object({
  organizationId: z.string().min(1),
  notifyLevel: inboxNotifyLevelSchema,
});

export type InboxNotifyPreferenceUpdateInput = z.infer<
  typeof inboxNotifyPreferenceUpdateSchema
>;

/**
 * What a notification rule is about. Rules resolve most-specific-first:
 * `MAILBOX` beats `DOMAIN`, and either beats the default.
 */
export const inboxNotifyScopeSchema = z.enum(["DOMAIN", "MAILBOX"]);

export type InboxNotifyScope = z.infer<typeof inboxNotifyScopeSchema>;

/**
 * Turn notifications on or off for one mailbox, or for a whole domain at once.
 *
 * A domain is only ever a *filter* over the mailboxes the caller already holds.
 * Switching acme.test on covers the one address they were granted, not the ten
 * the domain has — this can never widen what somebody hears about.
 */
export const inboxNotifyRuleUpdateSchema = z.object({
  organizationId: z.string().min(1),
  enabled: z.boolean(),
  target: z.discriminatedUnion("scope", [
    z.object({
      scope: z.literal("MAILBOX"),
      inboxAccountId: z.string().min(1),
    }),
    z.object({
      scope: z.literal("DOMAIN"),
      domain: z.string().min(1).max(253),
    }),
  ]),
});

export type InboxNotifyRuleUpdateInput = z.infer<
  typeof inboxNotifyRuleUpdateSchema
>;

/** One mailbox on the notification settings page. */
export interface InboxNotifyMailbox {
  inboxAccountId: string;
  email: string;
  /** The mailbox's display name, e.g. "Support". */
  name: string;
  /** Whether mail arriving here may notify, after rules are resolved. */
  enabled: boolean;
  /**
   * True when `enabled` comes from a rule of its own rather than being
   * inherited. The UI uses it to say "this one is a deliberate exception".
   */
  explicit: boolean;
}

/**
 * The mailboxes on one domain that this person can read — never the domain's
 * full address list.
 */
export interface InboxNotifyDomainGroup {
  domain: string;
  /**
   * `ALL` / `NONE` when every mailbox below agrees, `SOME` when they don't.
   * Derived, so the switch on screen always matches the ticks under it.
   */
  state: "ALL" | "NONE" | "SOME";
  mailboxes: InboxNotifyMailbox[];
}

/** Everything the notification settings page renders, in one response. */
export interface InboxNotifySettings {
  organizationId: string;
  /** Which mail within a notifying mailbox — the second, orthogonal axis. */
  notifyLevel: InboxNotifyLevel;
  domains: InboxNotifyDomainGroup[];
}

/** A stored rule, in the only shape the resolver needs to see. */
export interface InboxNotifyRuleLike {
  scope: InboxNotifyScope;
  domain: string | null;
  inboxAccountId: string | null;
  enabled: boolean;
}

/**
 * The domain half of an address, lowercased — the key domain rules are stored
 * under. An address with no `@` yields an empty string rather than throwing:
 * a malformed mailbox should group oddly on a settings page, not take the page
 * down.
 */
export function mailboxDomain(email: string): string {
  return email.split("@")[1]?.trim().toLowerCase() ?? "";
}

/**
 * Whether mail arriving at one mailbox may notify one person.
 *
 * The single home of the precedence rule, imported by both the API (to render
 * the settings page) and the worker (to decide a live push). Splitting it in
 * two is how a settings screen ends up confidently describing behaviour the
 * worker does not have.
 *
 * Most specific wins: a rule naming this mailbox, else one naming its domain,
 * else on. On is the default because a mailbox you were given and never had an
 * opinion about is one you presumably want to hear from — see the
 * `InboxNotifyRule` model comment.
 *
 * `rules` is expected to be small (one person's exceptions in one org), so a
 * linear scan is cheaper than the map that would replace it.
 */
export function resolveInboxNotify(
  rules: InboxNotifyRuleLike[],
  mailbox: { inboxAccountId: string; domain: string }
): { enabled: boolean; explicit: boolean } {
  const mailboxRule = rules.find(
    (rule) =>
      rule.scope === "MAILBOX" && rule.inboxAccountId === mailbox.inboxAccountId
  );
  if (mailboxRule) return { enabled: mailboxRule.enabled, explicit: true };

  const domainRule = rules.find(
    (rule) => rule.scope === "DOMAIN" && rule.domain === mailbox.domain
  );
  if (domainRule) return { enabled: domainRule.enabled, explicit: false };

  return { enabled: true, explicit: false };
}

/**
 * The payload a service worker receives. Kept deliberately small: push
 * services cap the encrypted body (~4 KB), and the body of an email must not
 * travel through a third-party push service in the first place.
 */
export const pushNotificationPayloadSchema = z.object({
  title: z.string(),
  body: z.string(),
  /** In-app path the notification opens, e.g. `/inbox?message=abc`. */
  url: z.string().optional(),
  /** Collapses same-tag notifications so ten replies don't stack ten alerts. */
  tag: z.string().optional(),
});

export type PushNotificationPayload = z.infer<
  typeof pushNotificationPayloadSchema
>;
