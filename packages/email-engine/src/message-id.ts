/**
 * RFC 5322 Message-ID on the sending account's own domain, e.g.
 * `<id@notify.example.com>`. A foreign or reserved right-hand side is a
 * small spam signal, and the From domain is the one we're authorized for.
 */
export function buildMessageId(localPart: string, fromEmail: string): string {
  const at = fromEmail.lastIndexOf("@");
  const domain = at === -1 ? "" : fromEmail.slice(at + 1).trim().toLowerCase();
  return `<${localPart}@${domain || "qqueue.invalid"}>`;
}
