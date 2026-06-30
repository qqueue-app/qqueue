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
  /**
   * Per-message DKIM signing. Set only for managed-mode sending domains whose
   * DNS is verified; omitted otherwise so QQueue trusts the upstream
   * server/relay to sign. Forwarded as Nodemailer's per-message `dkim` option.
   */
  dkim?: DkimSignOptions;
}

export interface DkimSignOptions {
  domainName: string;
  keySelector: string;
  /** PKCS#8 PEM private key. */
  privateKey: string;
}

export interface SendEmailResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
  provider: string;
  /**
   * The SMTP server's response line for a rejected recipient, when available.
   * Used to classify the bounce (hard vs soft) for auto-suppression.
   */
  rejectionResponse?: string;
}

export interface EmailProvider {
  send(payload: SendEmailPayload): Promise<SendEmailResult>;
  verify?(): Promise<void>;
}
