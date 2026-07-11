interface VerifyContext {
  host: string;
  port: number;
  secure: boolean;
}

/**
 * Translate an SMTP verification failure into plain-language, actionable
 * guidance, with the raw error appended in parentheses for debugging.
 *
 * Nodemailer overwrites `error.code` with its own types (ESOCKET, ETIMEDOUT,
 * EDNS, EAUTH, ETLS, ECONNECTION, ...) — the original Node/OpenSSL cause
 * (ECONNREFUSED, ENOTFOUND, TLS handshake text) survives only in the message,
 * so classification matches nodemailer codes plus message substrings.
 */
export function describeSmtpVerifyError(
  error: unknown,
  ctx: VerifyContext
): string {
  const err = (error ?? {}) as { message?: unknown; code?: unknown };
  const message = typeof err.message === "string" ? err.message : "";
  const code = typeof err.code === "string" ? err.code : "";
  // OpenSSL messages can end with a newline; keep the parenthetical on one line.
  const trimmed = message.trim();
  const detail = trimmed ? ` (${trimmed})` : "";

  // Implicit TLS opened against a plaintext/STARTTLS port: the server answered
  // the TLS handshake with its plaintext SMTP banner.
  if (/wrong version number|ssl3_get_record/i.test(message)) {
    return `This mail server doesn't expect an encrypted connection on port ${ctx.port}. Turn off "Secure TLS" — servers on ports 587 and 25 upgrade to a secure connection automatically — or switch to port 465.${detail}`;
  }

  // The mirror image: plaintext against an implicit-TLS port. The server waits
  // for a TLS handshake, so the greeting never arrives (or the socket closes).
  // Gated on port 465 — greeting timeouts on other ports are usually firewalls.
  if (
    !ctx.secure &&
    ctx.port === 465 &&
    ((code === "ETIMEDOUT" && message.includes("Greeting never received")) ||
      message.includes("Connection closed"))
  ) {
    return `Port 465 expects a secure connection from the start. Turn on "Secure TLS" and try again.${detail}`;
  }

  // A socket that opens but closes without an SMTP response is the fingerprint
  // of a firewall or endpoint-security filter killing plaintext-start SMTP.
  // Port 465 usually passes because it's encrypted from the first byte.
  if (message.includes("Connection closed")) {
    return `The connection was closed before the mail server responded — a firewall or security software on this machine or network may be blocking SMTP on port ${ctx.port}. Try port 465 with "Secure TLS" turned on.${detail}`;
  }

  if (code === "EAUTH") {
    return `The mail server rejected the username or password. Re-enter the credentials for this mailbox — some providers require an app-specific password.${detail}`;
  }

  if (message.includes("ECONNREFUSED")) {
    return `Nothing answered at ${ctx.host}:${ctx.port} — the connection was refused. Check the host and port, and make sure the mail server is running.${detail}`;
  }

  if (
    code === "EDNS" ||
    message.includes("ENOTFOUND") ||
    message.includes("EAI_AGAIN")
  ) {
    return `We couldn't find a server named "${ctx.host}". Check the host name for typos.${detail}`;
  }

  if (
    /self.signed/i.test(message) ||
    message.includes("certificate has expired") ||
    message.includes("unable to verify the first certificate") ||
    message.includes("unable to get local issuer") ||
    message.includes("altnames")
  ) {
    return `The server's security certificate isn't trusted — it may be self-signed, expired, or issued for a different host name.${detail}`;
  }

  if (code === "ETLS") {
    return `The server couldn't complete the secure handshake. Double-check the port and the "Secure TLS" setting.${detail}`;
  }

  if (code === "ETIMEDOUT" || code === "ESOCKET" || code === "ECONNECTION") {
    return `We couldn't reach ${ctx.host}:${ctx.port} — the connection timed out. Check the host and port, and make sure a firewall isn't blocking the connection.${detail}`;
  }

  return error instanceof Error
    ? `SMTP verification failed: ${error.message}`
    : "SMTP verification failed";
}
