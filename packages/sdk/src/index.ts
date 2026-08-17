export interface QQueueClientOptions {
  apiKey: string;
  baseUrl?: string;
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
    payload: PublicSendEmailInput
  ): Promise<{ id: string; status: string }> {
    const response = await fetch(`${this.baseUrl}/transactional-email/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
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
