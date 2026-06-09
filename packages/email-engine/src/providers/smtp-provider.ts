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

  async send(payload: SendEmailPayload): Promise<SendEmailResult> {
    const info = await this.transporter.sendMail(payload);

    return {
      messageId: info.messageId,
      accepted: info.accepted.map(String),
      rejected: info.rejected.map(String),
      provider: "smtp"
    };
  }
}
