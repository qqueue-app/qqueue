import { env } from "../../config/env.js";
import { HttpError } from "../../lib/http-error.js";

/**
 * Thin client for the Mailcow admin API (Phase 4 provisioning).
 *
 * Mailcow's REST API answers mutations with an array of
 * `{ type: "success" | "danger" | ..., msg: string | string[] }` entries and a
 * 200 status even on failure, so success is judged from the body, not the
 * HTTP code. Auth is the `X-API-Key` header (Admin -> API in Mailcow; the key
 * needs read/write access).
 *
 * The client is deliberately small: exactly the calls the Mailboxes page needs
 * (list domains and mailboxes, create/delete mailbox, reset password, toggle
 * active, app passwords) plus a `verify()` connectivity probe, mirroring how
 * the SMTP provider exposes one.
 */

interface MailcowResponseEntry {
  type?: string;
  msg?: string | string[];
}

export interface MailcowDomain {
  domain_name: string;
  active: boolean;
}

/** One mailbox as the server reports it, normalised to our own vocabulary. */
export interface MailcowMailbox {
  email: string;
  name: string;
  active: boolean;
  /** Bytes; 0 means unlimited. */
  quotaBytes: number;
  usedBytes: number;
}

// Mailcow is inconsistent about number-vs-string across versions and fields,
// so every numeric attribute goes through this rather than being trusted.
function toNumber(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
}

export interface MailcowClientOptions {
  apiUrl: string;
  apiKey: string;
  /** Request timeout in ms; Mailcow admin calls should be fast. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

function describeMessages(entries: MailcowResponseEntry[]): string {
  const parts = entries
    .filter((entry) => entry.type !== "success")
    .map((entry) =>
      Array.isArray(entry.msg) ? entry.msg.join(" ") : (entry.msg ?? "")
    )
    .filter(Boolean);
  return parts.join("; ") || "Mailcow reported an unspecified error";
}

export class MailcowClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(options: MailcowClientOptions) {
    this.apiUrl = options.apiUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.apiUrl}${path}`, {
        ...init,
        headers: {
          "X-API-Key": this.apiKey,
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new HttpError(
        502,
        `Could not reach Mailcow at ${this.apiUrl}: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
        "mailcow_unreachable"
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new HttpError(
        502,
        "Mailcow rejected the API key (check MAILCOW_API_KEY and its access level)",
        "mailcow_auth_failed"
      );
    }
    if (!response.ok) {
      throw new HttpError(
        502,
        `Mailcow answered ${response.status} for ${path}`,
        "mailcow_error"
      );
    }

    return response.json();
  }

  /**
   * Run a mutation and throw unless Mailcow's body reports success. Mailcow
   * returns 200 with `type: "danger"` entries on failure.
   */
  private async mutate(path: string, body: unknown): Promise<void> {
    const result = await this.request(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const entries = Array.isArray(result)
      ? (result as MailcowResponseEntry[])
      : [result as MailcowResponseEntry];
    if (!entries.some((entry) => entry.type === "success")) {
      throw new HttpError(502, describeMessages(entries), "mailcow_error");
    }
  }

  /** Connectivity + auth probe; also the domain source for the provision form. */
  async listDomains(): Promise<MailcowDomain[]> {
    const result = await this.request("/api/v1/get/domain/all");
    if (!Array.isArray(result)) {
      return [];
    }
    return (result as Array<Record<string, unknown>>)
      .filter((domain) => typeof domain.domain_name === "string")
      .map((domain) => ({
        domain_name: domain.domain_name as string,
        // Mailcow reports active as 0/1.
        active: domain.active === 1 || domain.active === "1",
      }));
  }

  async verify(): Promise<void> {
    await this.listDomains();
  }

  /**
   * Every mailbox on the server, or just one domain's. This is what lets the
   * Mailboxes page show addresses QQueue never provisioned — without it the
   * page can only report on its own `SMTPConnection` rows.
   *
   * Mailcow answers an unknown domain with a non-array body rather than a 404,
   * so a missing domain reads as "no mailboxes" instead of throwing.
   */
  async listMailboxes(domain?: string): Promise<MailcowMailbox[]> {
    const result = await this.request(
      domain
        ? `/api/v1/get/mailbox/all/${encodeURIComponent(domain)}`
        : "/api/v1/get/mailbox/all"
    );
    if (!Array.isArray(result)) {
      return [];
    }
    return (result as Array<Record<string, unknown>>)
      .filter((mailbox) => typeof mailbox.username === "string")
      .map((mailbox) => ({
        email: (mailbox.username as string).toLowerCase(),
        name: typeof mailbox.name === "string" ? mailbox.name : "",
        // Mailcow reports active as 0/1.
        active: mailbox.active === 1 || mailbox.active === "1",
        quotaBytes: toNumber(mailbox.quota),
        usedBytes: toNumber(mailbox.quota_used),
      }));
  }

  async createMailbox(input: {
    localPart: string;
    domain: string;
    name?: string;
    password: string;
  }): Promise<void> {
    await this.mutate("/api/v1/add/mailbox", {
      local_part: input.localPart,
      domain: input.domain,
      name: input.name ?? input.localPart,
      password: input.password,
      password2: input.password,
      quota: "0", // unlimited unless the domain caps it
      active: "1",
      force_pw_update: "0",
      tls_enforce_in: "1",
      tls_enforce_out: "1",
    });
  }

  async setMailboxPassword(email: string, password: string): Promise<void> {
    await this.mutate("/api/v1/edit/mailbox", {
      items: [email],
      attr: { password, password2: password },
    });
  }

  /**
   * Enable/disable delivery to a mailbox without destroying it. Reversible,
   * and the mailbox keeps everything already in it.
   */
  async setMailboxActive(email: string, active: boolean): Promise<void> {
    await this.mutate("/api/v1/edit/mailbox", {
      items: [email],
      attr: { active: active ? "1" : "0" },
    });
  }

  /**
   * App passwords let QQueue hold SMTP/IMAP credentials for the mailbox
   * without knowing the human's login password.
   */
  async createAppPassword(input: {
    email: string;
    name: string;
    password: string;
  }): Promise<void> {
    await this.mutate("/api/v1/add/app-passwd", {
      active: "1",
      username: input.email,
      app_passwd_name: input.name,
      app_passwd: input.password,
      app_passwd2: input.password,
      protocols: ["smtp_access", "imap_access"],
    });
  }

  async deleteMailbox(email: string): Promise<void> {
    await this.mutate("/api/v1/delete/mailbox", [email]);
  }
}

/** The instance's configured client, or null when provisioning is off. */
export function getMailcowClient(): MailcowClient | null {
  if (!env.MAILCOW_API_URL || !env.MAILCOW_API_KEY) {
    return null;
  }
  return new MailcowClient({
    apiUrl: env.MAILCOW_API_URL,
    apiKey: env.MAILCOW_API_KEY,
  });
}

/** SMTP/IMAP endpoint for provisioned mailboxes, derived from instance config. */
export function mailcowMailHost(): string | null {
  if (env.MAILCOW_MAIL_HOST) {
    return env.MAILCOW_MAIL_HOST;
  }
  if (!env.MAILCOW_API_URL) {
    return null;
  }
  return new URL(env.MAILCOW_API_URL).hostname;
}
