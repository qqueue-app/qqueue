import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Ban,
  BarChart3,
  CheckCircle2,
  Clock,
  MailOpen,
  MousePointerClick,
  Paperclip,
  Send,
  ShieldAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "../components/PageContainer.js";
import { PageHeader } from "../components/PageHeader.js";
import { EmailPreviewFrame } from "../components/EmailPreviewFrame.js";
import { EmptyState } from "../components/EmptyState.js";
import { normalizeContentId } from "../components/InboundHtmlFrame.js";
import {
  AttachmentPreviewDialog,
  attachmentPreviewKind,
  downloadBlob,
} from "../components/inbox/AttachmentPreviewDialog.js";
import {
  api,
  type SentEmailAttachment,
  type SentEmailEvent,
} from "../lib/api.js";
import { formatBytes, formatFullDate } from "../lib/format.js";
import { qk } from "../lib/query-client.js";
import {
  ORIGIN_LABEL,
  engagementLabel,
  outcomeOf,
  sendingAccountLabel,
} from "../lib/sent-email.js";
import { useSession } from "../lib/session-context.js";
import { useOrgQuery } from "../lib/use-api.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { Spinner } from "../components/ui/spinner.js";
import { Hint } from "../components/ui/tooltip.js";
import { cn } from "../lib/utils.js";

/*
  The pipeline's event types, in the reader's words.

  The enum is written for the code that stores it ("SENT" is the moment the
  provider accepted the message, not the moment someone pressed send), so every
  one of them is relabelled here rather than title-cased on the way out.
*/
const EVENT_LABEL: Record<SentEmailEvent["type"], string> = {
  QUEUED: "Queued",
  SENT: "Handed to the mail server",
  DELIVERED: "Delivered",
  OPENED: "Opened",
  CLICKED: "Link clicked",
  BOUNCED: "Bounced",
  COMPLAINED: "Marked as spam",
  FAILED: "Failed to send",
};

const EVENT_ICON: Record<SentEmailEvent["type"], LucideIcon> = {
  QUEUED: Clock,
  SENT: Send,
  DELIVERED: CheckCircle2,
  OPENED: MailOpen,
  CLICKED: MousePointerClick,
  BOUNCED: Ban,
  COMPLAINED: ShieldAlert,
  FAILED: TriangleAlert,
};

/**
 * The second line of a folded history entry, or null for a one-off.
 *
 * An open is one fetch of the tracking pixel, and a mail client re-fetches on
 * every render — so "Opened" thirteen times is usually one person with the
 * message on screen, not thirteen readers. Saying that plainly, with the span
 * it happened over, is the whole point of folding: a count without a last
 * timestamp reads as thirteen readers all over again.
 */
function repeatSummary(event: SentEmailEvent): string | null {
  const parts: string[] = [];
  if (event.count > 1) {
    parts.push(`${event.count} times`);
    if (event.lastOccurredAt) {
      parts.push(`last ${formatFullDate(event.lastOccurredAt)}`);
    }
  }
  if (event.automatedCount > 0) {
    parts.push(
      event.automatedCount === event.count
        ? "looked automated"
        : `${event.automatedCount} looked automated`
    );
  }
  return parts.length ? parts.join(" · ") : null;
}

function eventTone(type: SentEmailEvent["type"]) {
  if (type === "BOUNCED" || type === "COMPLAINED" || type === "FAILED") {
    return "text-err";
  }
  if (type === "DELIVERED" || type === "OPENED" || type === "CLICKED") {
    return "text-ok";
  }
  return "text-text-tertiary";
}

/**
 * Point the body's `cid:` images at the parts downloaded for them.
 *
 * Inline attachments travel inside the message, so in the recipient's client
 * they resolve against the MIME parts sitting beside the HTML. Here there are
 * no parts — only rows in Postgres and blobs in object storage — so the reader
 * fetches each one over the authenticated download route and swaps the `cid:`
 * URL for a local `blob:` one. A part that can't be resolved loses its `src`
 * rather than rendering as a broken-image icon.
 *
 * Parsed with DOMParser (an inert document: nothing loads, nothing runs) rather
 * than by regex, so the markup can't be mangled into meaning one thing here and
 * another inside the frame.
 */
function resolveInlineImages(
  html: string,
  inlineImages: Record<string, string>
) {
  if (!html.includes("cid:")) return html;

  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const img of Array.from(doc.querySelectorAll("img"))) {
    const src = img.getAttribute("src") ?? "";
    if (!/^cid:/i.test(src)) continue;
    const resolved = inlineImages[normalizeContentId(src.slice(4))];
    if (resolved) img.setAttribute("src", resolved);
    else img.removeAttribute("src");
    img.removeAttribute("srcset");
  }

  // Serialized as a whole document rather than as body content: the send
  // pipeline produces a complete MJML document whose <head> carries the media
  // queries that make it responsive, and dropping those would render the mail
  // at a width no recipient ever saw it at.
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}

/**
 * One sent message, as it went out.
 *
 * The archive's rows say what *happened* to an email; this says what it *was*.
 * A route rather than a dialog because it is a document — long enough to
 * scroll, worth linking to, and worth having a back button of its own.
 *
 * The body here is the body as stored, which is deliberately not byte-for-byte
 * what left the building: the send worker injects the open pixel and rewrites
 * links through the click redirect on the way out. Rendering *that* copy would
 * fire this message's own tracking every time somebody read their own archive
 * — every open would create an open — so the tracked version is the one nobody
 * on this side ever sees.
 */
export function SentMessage() {
  const { id } = useParams<{ id: string }>();
  const { currentOrganizationId: organizationId } = useSession();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    attachment: SentEmailAttachment;
    blob: Blob;
  } | null>(null);
  /** Resolved `cid:` parts, keyed by normalized Content-ID. */
  const [inlineImages, setInlineImages] = useState<Record<string, string>>({});

  const emailQuery = useOrgQuery(
    organizationId,
    qk.sentMessage(organizationId ?? "", id ?? ""),
    (orgId) => api.getSentEmail(id!, orgId),
    { enabled: Boolean(id) }
  );

  const email = emailQuery.data;

  const attachments = email?.attachments;
  const inlineParts = useMemo(
    () => (attachments ?? []).filter((file) => file.isInline),
    [attachments]
  );
  const files = useMemo(
    () => (attachments ?? []).filter((file) => !file.isInline),
    [attachments]
  );

  /*
    Fetch the inline parts once the message is in hand.

    Deliberately not blocking: a part that fails to download costs one missing
    image, and must never keep the message itself off the screen.

    Safe to key on the memo rather than on the ids: TanStack Query shares
    structure between refetches, so an unchanged attachment list keeps the same
    reference, the memo does not recompute, and this does not re-download the
    parts and churn a fresh set of blob URLs.
  */
  useEffect(() => {
    if (inlineParts.length === 0) {
      setInlineImages({});
      return;
    }

    let cancelled = false;
    const urls: string[] = [];

    void Promise.all(
      inlineParts.map(async (part) => {
        if (!part.contentId) return null;
        const blob = await api.downloadAttachment(part.id).catch(() => null);
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        return [normalizeContentId(part.contentId), url] as const;
      })
    ).then((entries) => {
      if (cancelled) return;
      setInlineImages(
        Object.fromEntries(
          entries.filter((entry): entry is [string, string] => entry !== null)
        )
      );
    });

    return () => {
      cancelled = true;
      // Revoked on the way out so a session spent reading the archive doesn't
      // pin every inline image it has ever opened in memory.
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [inlineParts]);

  const body = useMemo(
    () => (email?.html ? resolveInlineImages(email.html, inlineImages) : null),
    [email?.html, inlineImages]
  );

  /*
    Whether the history needs a sentence explaining itself.

    Only when it would otherwise mislead: a message opened once needs no gloss,
    but "Opened · 13 times" invites the reading that thirteen people read it,
    and an open marked automated invites the opposite mistake — that nobody did.
  */
  const opensNeedExplaining = useMemo(
    () =>
      (email?.events ?? []).some(
        (event) =>
          event.type === "OPENED" &&
          (event.count > 1 || event.automatedCount > 0)
      ),
    [email?.events]
  );

  async function openAttachment(file: SentEmailAttachment) {
    setOpeningId(file.id);
    try {
      const blob = await api.downloadAttachment(file.id);
      if (attachmentPreviewKind(file.contentType)) {
        setPreview({ attachment: file, blob });
      } else {
        downloadBlob(blob, file.filename);
      }
    } catch {
      toast.error("Couldn't open that file.");
    } finally {
      setOpeningId(null);
    }
  }

  if (emailQuery.isPending) {
    return (
      <>
        <PageHeader
          title="Sent email"
          description="Opening this message."
          breadcrumb={{ label: "Sent", to: "/sent" }}
        />
        <PageContainer className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </PageContainer>
      </>
    );
  }

  if (!email) {
    return (
      <>
        <PageHeader
          title="Sent email"
          description="This message isn't in your archive."
          breadcrumb={{ label: "Sent", to: "/sent" }}
        />
        <PageContainer>
          <EmptyState
            icon={Send}
            title="Message not found"
            description="It may have been deleted, or it went out from a mailbox you don't have access to."
            action={
              <Button asChild variant="outline">
                <Link to="/sent">Back to Sent</Link>
              </Button>
            }
          />
        </PageContainer>
      </>
    );
  }

  const outcome = outcomeOf(email);
  const engagement = engagementLabel(email);
  const sentAt = email.sentAt ?? email.createdAt;

  return (
    <>
      <PageHeader
        title={email.subject || "(no subject)"}
        description={`${ORIGIN_LABEL[email.origin]} · ${formatFullDate(sentAt)}`}
        breadcrumb={{ label: "Sent", to: "/sent" }}
      />

      <PageContainer className="space-y-6">
        {/* ------------------------------------------------------- envelope */}
        <section className="rounded-card border border-border bg-surface p-4 shadow-card sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={outcome.variant}>{outcome.label}</Badge>
            {engagement ? (
              <span className="text-ui text-text-tertiary" data-numeric>
                {engagement}
              </span>
            ) : null}
            {email.campaignName ? (
              email.campaignId ? (
                <Button asChild variant="outline" size="sm" className="ml-auto">
                  <Link to={`/campaigns/${email.campaignId}/analytics`}>
                    <BarChart3 />
                    {email.campaignName}
                  </Link>
                </Button>
              ) : (
                <span className="ml-auto truncate text-ui text-text-tertiary">
                  {email.campaignName}
                </span>
              )
            ) : null}
          </div>

          {/*
            Above the addresses, not down in the history: when a send failed,
            the reason is the only thing anyone opened this page for, and making
            them scroll past the envelope to find it is the wrong order.
          */}
          {email.failureReason ? (
            <p className="mt-3 rounded-control bg-err-bg px-3 py-2 text-ui leading-5 text-err">
              {email.failureReason}
            </p>
          ) : null}

          <dl className="mt-4 grid gap-3 text-ui sm:grid-cols-2">
            <Detail label="From">
              <span className="break-all">{sendingAccountLabel(email)}</span>
              {email.sendingAccount ? (
                <p className="text-meta text-text-tertiary">
                  {email.sendingAccount.name}
                </p>
              ) : null}
            </Detail>

            <Detail label="To">
              <AddressList addresses={email.to} />
            </Detail>

            {email.cc.length > 0 ? (
              <Detail label="Cc">
                <AddressList addresses={email.cc} />
              </Detail>
            ) : null}

            {/* Shown because this is the sender's own copy: Bcc is hidden from
                recipients, never from the person who sent it. */}
            {email.bcc.length > 0 ? (
              <Detail label="Bcc">
                <AddressList addresses={email.bcc} />
              </Detail>
            ) : null}

            {email.replyTo ? (
              <Detail label="Reply-To">
                <span className="break-all">{email.replyTo}</span>
              </Detail>
            ) : null}
          </dl>
        </section>

        {/* ----------------------------------------------------------- body */}
        <section className="space-y-2">
          <SectionTitle>Message</SectionTitle>
          {body ? (
            <EmailPreviewFrame
              html={body}
              title={`Message: ${email.subject || "(no subject)"}`}
              data-testid="sent-body"
            />
          ) : email.text ? (
            /* A text-only send. Rendered as a text node rather than as markup:
               there is no HTML part here to sandbox, and treating plain text as
               a document would give it meaning it never had. */
            <div
              className="whitespace-pre-wrap rounded-card border border-border bg-surface p-4 text-body leading-6 text-text"
              data-testid="sent-body"
            >
              {email.text}
            </div>
          ) : (
            <p className="rounded-card border border-border bg-surface p-4 text-ui text-text-tertiary">
              This message has no stored body.
            </p>
          )}
        </section>

        {/* ---------------------------------------------------- attachments */}
        {files.length > 0 ? (
          <section className="space-y-2">
            <SectionTitle>
              {files.length === 1 ? "Attachment" : "Attachments"}
            </SectionTitle>
            <div className="flex flex-wrap gap-2">
              {files.map((file) => (
                <Hint
                  key={file.id}
                  label={`${
                    attachmentPreviewKind(file.contentType)
                      ? "Open"
                      : "Download"
                  } ${file.filename} (${formatBytes(file.size)})`}
                >
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={openingId === file.id}
                    onClick={() => void openAttachment(file)}
                    className="h-auto gap-2 py-field"
                  >
                    {openingId === file.id ? (
                      <Spinner className="h-3.5 w-3.5" />
                    ) : (
                      <Paperclip className="h-3.5 w-3.5" />
                    )}
                    <span className="max-w-cell truncate">{file.filename}</span>
                    <span className="text-meta text-text-tertiary" data-numeric>
                      {formatBytes(file.size)}
                    </span>
                  </Button>
                </Hint>
              ))}
            </div>
          </section>
        ) : null}

        {/* -------------------------------------------------------- history */}
        <section className="space-y-2">
          <SectionTitle>History</SectionTitle>
          {opensNeedExplaining ? (
            <p className="text-meta leading-5 text-text-tertiary">
              An open is recorded every time this message&rsquo;s images are
              fetched, so one reader can register several. Fetches that looked
              like a scanner or a privacy proxy rather than a person are marked,
              and left out of the open count.
            </p>
          ) : null}
          {email.events.length > 0 ? (
            /* Named: the envelope above already renders the recipients as a
               list, so "the list of events" has to be findable as itself. */
            <ol
              aria-label="Message history"
              className="rounded-card border border-border bg-surface"
            >
              {email.events.map((event) => {
                const Icon = EVENT_ICON[event.type];
                const repeat = repeatSummary(event);
                return (
                  <li
                    key={event.id}
                    className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0"
                  >
                    <Icon
                      className={cn(
                        "mt-0.5 h-4 w-4 shrink-0",
                        eventTone(event.type)
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-ui font-medium text-text">
                        {EVENT_LABEL[event.type]}
                      </div>
                      {event.detail ? (
                        <p className="mt-0.5 break-all text-meta text-text-secondary">
                          {event.detail}
                        </p>
                      ) : null}
                      {repeat ? (
                        <p className="mt-0.5 text-meta text-text-tertiary">
                          {repeat}
                        </p>
                      ) : null}
                    </div>
                    <time
                      dateTime={event.occurredAt}
                      className="shrink-0 whitespace-nowrap text-meta text-text-tertiary"
                      data-numeric
                    >
                      {formatFullDate(event.occurredAt)}
                    </time>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="rounded-card border border-border bg-surface p-4 text-ui text-text-tertiary">
              Nothing recorded beyond the send itself.
            </p>
          )}

          {/* The Message-ID is what you quote to whoever is reading the mail
              server's logs, so it belongs on this page — but nowhere near the
              top of it. */}
          {email.messageId ? (
            <p className="pt-1 text-meta text-text-tertiary">
              Message-ID <span className="break-all">{email.messageId}</span>
            </p>
          ) : null}
        </section>
      </PageContainer>

      <AttachmentPreviewDialog
        preview={preview}
        onClose={() => setPreview(null)}
      />
    </>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-meta font-medium uppercase tracking-eyebrow text-text-tertiary">
      {children}
    </h2>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-meta font-medium uppercase tracking-eyebrow text-text-tertiary">
        {label}
      </dt>
      <dd className="mt-1 min-w-0 text-text">{children}</dd>
    </div>
  );
}

function AddressList({ addresses }: { addresses: string[] }) {
  if (addresses.length === 0) {
    return <span className="text-text-tertiary">—</span>;
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {addresses.map((address) => (
        <li key={address} className="break-all">
          {address}
        </li>
      ))}
    </ul>
  );
}
