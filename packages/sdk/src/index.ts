export interface QQueueClientOptions {
  apiKey: string;
  baseUrl?: string;
}

export interface InlineAttachment {
  filename: string;
  /**
   * Strict, padded base64. Inline attachments are for small per-message
   * assets (QR codes, barcodes, small logos) and are capped at 256 KB decoded,
   * 10 per send; upload larger files ahead of time via POST /attachments and
   * pass their ids in `attachmentIds` instead.
   */
  contentBase64: string;
  contentType?: string;
  /**
   * Content-ID for inline display: HTML referencing `cid:<cid>` renders the
   * attachment in place, and mail clients show it even when remote images are
   * blocked. Omit for a regular downloadable attachment.
   */
  cid?: string;
}

export interface PublicSendEmailInput {
  to: string;
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  /**
   * Which sending account to send as, named by the address it sends as. Must
   * match a sending account on the organization the API key belongs to —
   * QQueue resolves the account and builds the From header from it, so an
   * address it does not recognize is a 404, not a send.
   *
   * Omit both this and `smtpConnectionId` to use the organization default.
   */
  from?: string;
  /** The same choice as `from`, made by account id. Wins if both are set. */
  smtpConnectionId?: string;
  templateId?: string;
  subject?: string;
  html?: string;
  text?: string;
  variables?: Record<string, unknown>;
  /** Message-ID this replies to, for threading in the recipient's client. */
  inReplyTo?: string;
  references?: string[];
  /** ISO-8601. The job is queued now and delivered then. */
  scheduledAt?: string;
  /** Ids from POST /attachments, uploaded before the send. */
  attachmentIds?: string[];
  /** Small base64 attachments carried on the send itself, optionally inline. */
  attachments?: InlineAttachment[];
}

export class QQueueError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "QQueueError";
    this.status = status;
    this.code = code;
  }
}

export class QQueueClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: QQueueClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "http://localhost:4000/api/v1").replace(
      /\/+$/,
      ""
    );
  }

  async sendEmail(
    payload: PublicSendEmailInput,
    options?: {
      /**
       * Retry key (sent as the `Idempotency-Key` header, max 255 chars). A
       * repeat send with the same key returns the original job instead of
       * sending a second copy — pass one when your caller retries on failure.
       */
      idempotencyKey?: string;
    }
  ): Promise<{ id: string; status: string }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json"
    };
    if (options?.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }

    const response = await fetch(`${this.baseUrl}/transactional-email/send`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    const body = (await response.json().catch(() => null)) as
      | {
          data?: { id?: string; status?: string; emailJob?: { id?: string; status?: string } };
          error?: { code?: string; message?: string };
        }
      | null;

    if (!response.ok) {
      throw new QQueueError(
        response.status,
        body?.error?.message ?? "QQueue request failed",
        body?.error?.code
      );
    }

    const id = body?.data?.id ?? body?.data?.emailJob?.id;
    const status = body?.data?.status ?? body?.data?.emailJob?.status;
    if (!id || !status) {
      throw new QQueueError(
        response.status,
        "QQueue response missing email id or status"
      );
    }

    return { id, status };
  }
}
