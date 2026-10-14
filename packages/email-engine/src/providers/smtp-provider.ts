import nodemailer, { type Transporter } from "nodemailer";
import type {
  EmailProvider,
  SendEmailPayload,
  SendEmailResult,
} from "../types/index.js";

export interface SMTPProviderOptions {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  /**
   * Fail-fast overrides (ms), passed through to Nodemailer. Interactive
   * verification uses these; sends keep Nodemailer's defaults.
   */
  connectionTimeout?: number;
  greetingTimeout?: number;
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
    let info;
    try {
      info = await this.transporter.sendMail(payload);
    } catch (error) {
      const failure = error as {
        code?: string;
        command?: string;
        rejected?: string[];
        response?: string;
        rejectedErrors?: Array<{ recipient?: string; response?: string }>;
      };
      // A definite RCPT rejection is an outcome, not an uncertain network error.
      if (
        failure.code === "EENVELOPE" &&
        failure.command === "RCPT TO" &&
        failure.rejected?.length
      ) {
        return {
          messageId: payload.messageId ?? "",
          accepted: [],
          rejected: failure.rejected,
          provider: "smtp",
          rejectionResponse: failure.response,
          rejections: failure.rejected.map((email) => ({
            email,
            response:
              failure.rejectedErrors?.find((entry) => entry.recipient === email)
                ?.response ?? failure.response,
          })),
        };
      }
      throw error;
    }

    // Nodemailer exposes per-recipient errors on `rejectedErrors`; fall back to
    // the transaction's last response line. Either gives the bounce classifier
    // an SMTP status code / phrase to work with.
    const rejectedErrors = (
      info as unknown as {
        rejectedErrors?: Array<{
          recipient?: string;
          responseCode?: number;
          response?: string;
        }>;
      }
    ).rejectedErrors;
    const firstError = rejectedErrors?.[0];
    const rejectionResponse =
      firstError?.response ??
      (firstError?.responseCode
        ? String(firstError.responseCode)
        : undefined) ??
      (info as unknown as { response?: string }).response;

    return {
      messageId: info.messageId,
      accepted: info.accepted.map(String),
      rejected: info.rejected.map(String),
      provider: "smtp",
      rejections: info.rejected.map(String).map((email: string) => ({
        email,
        response:
          rejectedErrors?.find((entry) => entry.recipient === email)
            ?.response ?? rejectionResponse,
      })),
      rejectionResponse:
        info.rejected.length > 0 ? rejectionResponse : undefined,
    };
  }
}
