export interface EmailAttachment {
  filename: string;
  /** base64 string or Buffer (Nodemailer-compatible). */
  content: string | Buffer;
  contentType?: string;
}

export interface SendEmailPayload {
  from: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  /** RFC 5322 In-Reply-To: the Message-ID this message replies to. */
  inReplyTo?: string;
  /** RFC 5322 References: the thread's prior Message-IDs. */
  references?: string | string[];
  /** Extra raw headers (e.g. List-Unsubscribe). Forwarded to Nodemailer as-is. */
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
}

export interface SendEmailResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
  provider: string;
}

export interface EmailProvider {
  send(payload: SendEmailPayload): Promise<SendEmailResult>;
  verify?(): Promise<void>;
}
