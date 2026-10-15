import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api.js";
import { qk } from "../../lib/query-client.js";
import { useOrgQuery } from "../../lib/use-api.js";
import { useSession } from "../../lib/session-context.js";
import { Button } from "../ui/button.js";

export interface SignatureStamp {
  smtpConnectionId: string;
  html: string;
}
export function signatureStamp(value: unknown): SignatureStamp | undefined {
  if (typeof value !== "object" || value === null) return;
  const stamp = value as Record<string, unknown>;
  return typeof stamp.smtpConnectionId === "string" &&
    typeof stamp.html === "string"
    ? { smtpConnectionId: stamp.smtpConnectionId, html: stamp.html }
    : undefined;
}
function signatureHtml(text: string) {
  return `<p>${text.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!).replace(/\r?\n/g, "<br>")}</p>`;
}
export function replaceSignature(
  value: string,
  oldHtml: string | undefined,
  next: string
) {
  const close = /<\/body\s*>|<\/html\s*>/i.exec(value);
  const boundary = close?.index ?? value.length;
  const body = value.slice(0, boundary),
    tail = value.slice(boundary);
  const replaced = Boolean(oldHtml && body.endsWith(oldHtml));
  const prefix = replaced ? body.slice(0, -oldHtml!.length) : body;
  return { html: `${prefix || "<p></p>"}${next}${tail}`, replaced };
}
export function SignatureControl({
  organizationId,
  connectionId,
  mailboxEmail,
  value,
  onChange,
  stamp,
  onStamp,
  autoReady = false,
  generation,
  disabled = false,
}: {
  organizationId: string;
  connectionId?: string;
  mailboxEmail?: string;
  value: string;
  onChange: (html: string) => void;
  stamp?: SignatureStamp;
  onStamp: (stamp: SignatureStamp | undefined) => void;
  autoReady?: boolean;
  generation: string;
  disabled?: boolean;
}) {
  const { user } = useSession();
  const query = useOrgQuery(
    organizationId,
    qk.mailSignatures(organizationId, user?.id ?? ""),
    (id) => api.listMailSignatures(id),
    { meta: { silent: true } }
  );
  const selected = (query.data ?? []).find((signature) =>
    connectionId
      ? signature.smtpConnectionId === connectionId
      : mailboxEmail
        ? signature.fromEmail.toLowerCase() === mailboxEmail.toLowerCase()
        : signature.isDefault
  );
  const html = selected?.text.trim() ? signatureHtml(selected.text) : "";
  const initialized = useRef<string>();
  const [edited, setEdited] = useState(false);
  function insert() {
    if (disabled || !selected || !html) return;
    const next = replaceSignature(value, stamp?.html, html);
    onChange(next.html);
    onStamp({ smtpConnectionId: selected.smtpConnectionId, html });
    setEdited(false);
  }
  useEffect(() => {
    if (disabled || query.isPending || query.isError) return;
    if (
      stamp &&
      selected &&
      stamp.smtpConnectionId !== selected.smtpConnectionId
    ) {
      const nextHtml = selected.enabled ? html : "";
      const next = replaceSignature(value, stamp.html, nextHtml);
      if (next.replaced) {
        onChange(next.html);
        onStamp(
          nextHtml
            ? { smtpConnectionId: selected.smtpConnectionId, html: nextHtml }
            : undefined
        );
        setEdited(false);
      } else setEdited(true);
      return;
    }
    if (initialized.current === generation || !autoReady) return;
    initialized.current = generation;
    if (
      !value
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, "")
        .trim() &&
      html &&
      selected?.enabled
    )
      insert();
  }, [
    generation,
    autoReady,
    disabled,
    selected?.smtpConnectionId,
    html,
    query.isPending,
    query.isError,
  ]);
  return (
    <div className="space-y-2 text-meta text-text-secondary">
      {html ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || query.isPending}
          onClick={insert}
        >
          Insert signature
        </Button>
      ) : (
        <Link
          to="/settings/signatures"
          className="underline underline-offset-2"
        >
          Set up your signature
        </Link>
      )}
      {edited ? (
        <p>
          Your signature was edited in this draft. Update it manually or insert
          the selected account’s signature.
        </p>
      ) : null}
      {query.isError ? (
        <p>
          Couldn't load your signature.{" "}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => void query.refetch()}
          >
            Try again
          </Button>
        </p>
      ) : null}
    </div>
  );
}
