import type { SendEmailInput } from "@qqueue/shared";

export interface QQueueClientOptions {
  apiKey: string;
  baseUrl?: string;
}

export class QQueueClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: QQueueClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "http://localhost:4000/api/v1";
  }

  async sendEmail(payload: SendEmailInput): Promise<{ id: string }> {
    // TODO: Call POST /transactional-email/send once the API is implemented.
    void this.apiKey;
    void this.baseUrl;
    void payload;

    throw new Error("QQueueClient.sendEmail is not implemented yet.");
  }
}

export type { SendEmailInput };
