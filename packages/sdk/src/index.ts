export interface QQueueClientOptions {
  apiKey: string;
  baseUrl?: string;
}

export interface PublicSendEmailInput {
  to: string;
  smtpConnectionId?: string;
  templateId?: string;
  subject?: string;
  html?: string;
  text?: string;
  variables?: Record<string, unknown>;
  scheduledAt?: string;
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
