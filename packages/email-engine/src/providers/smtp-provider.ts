import nodemailer, { type Transporter } from "nodemailer";
import type {
  EmailProvider,
  SendEmailPayload,
  SendEmailResult
} from "../types/index.js";

export interface SMTPProviderOptions {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

export class SMTPProvider implements EmailProvider {
  private readonly transporter: Transporter;

  constructor(options: SMTPProviderOptions) {
    this.transporter = nodemailer.createTransport(options);
  }

  async verify(): Promise<void> {
    await this.transporter.verify();
  }

  async send(payload: SendEmailPayload): Promise<SendEmailResult> {
    const info = await this.transporter.sendMail(payload);

    // Nodemailer exposes per-recipient errors on `rejectedErrors`; fall back to
    // the transaction's last response line. Either gives the bounce classifier
    // an SMTP status code / phrase to work with.
    const rejectedErrors = (
      info as unknown as {
        rejectedErrors?: Array<{ responseCode?: number; response?: string }>;
      }
    ).rejectedErrors;
    const firstError = rejectedErrors?.[0];
    const rejectionResponse =
      firstError?.response ??
      (firstError?.responseCode ? String(firstError.responseCode) : undefined) ??
      (info as unknown as { response?: string }).response;

    return {
      messageId: info.messageId,
      accepted: info.accepted.map(String),
      rejected: info.rejected.map(String),
      provider: "smtp",
      rejectionResponse: info.rejected.length > 0 ? rejectionResponse : undefined
    };
  }
}
