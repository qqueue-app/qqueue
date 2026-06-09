import type {
  EmailProvider,
  SendEmailPayload,
  SendEmailResult
} from "../types/index.js";

abstract class FutureProvider implements EmailProvider {
  async send(payload: SendEmailPayload): Promise<SendEmailResult> {
    void payload;
    // TODO: Implement provider-specific API integration.
    throw new Error(`${this.constructor.name} is not implemented yet.`);
  }
}

export class MailcowSMTPProvider extends FutureProvider {}
export class SESProvider extends FutureProvider {}
export class ResendProvider extends FutureProvider {}
export class BrevoProvider extends FutureProvider {}
export class PostmarkProvider extends FutureProvider {}
