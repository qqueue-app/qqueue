import {
  useLayoutEffect,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import type { MailSearchInput, MailSearchRow } from "@qqueue/shared";
import {
  ArrowLeft,
  FileEdit,
  RefreshCw,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../lib/api.js";
import { qk } from "../lib/query-client.js";
import { useSession } from "../lib/session-context.js";
import {
  useApiMutation,
  useOrgInfiniteQuery,
  useOrgQuery,
} from "../lib/use-api.js";
import { useReadingPreference } from "../lib/reading-preference.js";
import { useMediaQuery } from "../lib/use-media-query.js";
import { formatMailDate, formatFullDate } from "../lib/format.js";
import { cn } from "../lib/utils.js";
import { DataGrid } from "../components/ui/data-grid.js";
import { Button } from "../components/ui/button.js";
import { IconButton } from "../components/ui/icon-button.js";
import { Input } from "../components/ui/input.js";
import { Spinner } from "../components/ui/spinner.js";
import { Badge } from "../components/ui/badge.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import { EmptyState } from "../components/EmptyState.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { EmailPreviewFrame } from "../components/EmailPreviewFrame.js";
const InboxReader = lazy(() =>
  import("./Inbox.js").then((module) => ({ default: module.Inbox }))
);
const OutgoingReader = lazy(() =>
  import("./SentMessage.js").then((module) => ({ default: module.SentMessage }))
);
const positions = new Map<string, number>();
const labels = {
  ALL: "Search mail",
  RECEIVED: "Received",
  SENT: "Sent",
  OUTBOX: "Outbox",
  DRAFTS: "Drafts",
};
function preview(html: string) {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}
function status(row: MailSearchRow) {
  if (row.kind !== "SENT") return row.label;
  if (row.scheduledAt && (row.status === "PENDING" || row.status === "QUEUED"))
    return `Scheduled for ${formatFullDate(row.scheduledAt)}`;
  return {
    PENDING: "Queued",
    QUEUED: "Queued",
    PROCESSING: "Sending",
    SENT: "Sent to mail server",
    FAILED: "Failed",
    UNCERTAIN: "Delivery unconfirmed",
    SUPPRESSED: "Not sent — recipients blocked",
    CANCELLED: "Cancelled",
  }[row.status ?? "SENT"];
}
export function MailFolder({
  view = "ALL",
}: {
  view?: MailSearchInput["view"];
}) {
  const { user, currentOrganizationId } = useSession();
  const [, setParams] = useSearchParams();
  const owner = `${user?.id}:${currentOrganizationId}`;
  const previous = useRef(owner);
  useEffect(() => {
    if (previous.current === owner) return;
    previous.current = owner;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        [
          "message",
          "job",
          "draft",
          "replyDraft",
          "replyBackup",
          "beforeMessage",
          "afterMessage",
          "move",
          "address",
        ].forEach((key) => next.delete(key));
        return next;
      },
      { replace: true }
    );
  }, [owner, setParams]);
  return (
    <MailFolderWorkspace
      key={`${user?.id}:${currentOrganizationId}:${view}`}
      view={view}
    />
  );
}
function MailFolderWorkspace({ view }: { view: MailSearchInput["view"] }) {
  const { user, currentOrganizationId: org } = useSession();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const title = labels[view];
  const q = params.get("q")?.trim() ?? "";
  const mailbox = params.get("address") ?? "";
  const messageId = params.get("message"),
    jobId = params.get("job"),
    draftId = params.get("draft");
  const selected = Boolean(messageId || jobId || draftId);
  const [input, setInput] = useState(q);
  const [cancelId, setCancelId] = useState<string>();
  const [removeId, setRemoveId] = useState<string>();
  const desktop = useMediaQuery("(min-width:1024px)");
  const reading = useReadingPreference(user?.id ?? "");
  const pane = desktop && reading === "pane";
  const scroll = useRef<HTMLDivElement>(null);
  const readerRegion = useRef<HTMLElement>(null);
  const lastSelection = useRef<string | null>(null);
  const selection = messageId || jobId || draftId;
  useEffect(() => {
    const previous = lastSelection.current;
    lastSelection.current = selection;
    if (
      previous === selection ||
      document.activeElement?.closest("input,textarea,[contenteditable='true']")
    )
      return;
    requestAnimationFrame(() => {
      if (selection) readerRegion.current?.focus({ preventScroll: true });
      else scroll.current?.focus({ preventScroll: true });
    });
  }, [selection]);
  const filters = useMemo(
    () => ({ view, q: q || undefined, mailbox: mailbox || undefined }),
    [view, q, mailbox]
  );
  const positionKey = JSON.stringify([user?.id, org, filters]);
  useEffect(() => {
    if (pane || selected) return;
    const rememberScroll = () => positions.set(positionKey, window.scrollY);
    window.addEventListener("scroll", rememberScroll, { passive: true });
    return () => window.removeEventListener("scroll", rememberScroll);
  }, [pane, selected, positionKey]);

  const mail = useOrgInfiniteQuery(
    org,
    qk.mailSearch(org ?? "", user?.id ?? "", filters),
    (organizationId, cursor) =>
      api.searchMail(organizationId, { ...filters, cursor, limit: 25 })
  );
  const accounts = useOrgQuery(
    org,
    qk.searchableMailboxes(org ?? "", user?.id ?? ""),
    (id) => api.searchableMailboxes(id)
  );
  const rows = mail.data?.pages.flatMap((page) => page.rows) ?? [];
  const draft = useOrgQuery(
    org,
    qk.composerDraft(org ?? "", user?.id ?? "", draftId ?? ""),
    () => api.getEmailDraft(draftId!),
    { enabled: Boolean(draftId), refetchInterval: 10000 }
  );
  const cancel = useApiMutation(
    (id: string) => api.cancelOutboxEmail(id, org!),
    {
      successMessage:
        "Remaining queued deliveries cancelled. Check recipient outcomes for anything already sent.",
      onSuccess: () => {
        setCancelId(undefined);
        void mail.refetch();
      },
      errorMessage:
        "Couldn't cancel this message. Its current delivery status is kept.",
    }
  );
  const remove = useApiMutation((id: string) => api.deleteEmailDraft(id), {
    successMessage: "Draft removed.",
    onSuccess: () => {
      setRemoveId(undefined);
      close();
      void mail.refetch();
    },
  });
  useEffect(() => setInput(q), [q]);
  useEffect(() => {
    if (input.trim() === q) return;
    const timer = setTimeout(() => change({ q: input.trim() || null }), 300);
    return () => clearTimeout(timer);
  }, [input, q]);
  useLayoutEffect(() => {
    if (!selected) {
      const top = positions.get(positionKey) ?? 0;
      if (pane && scroll.current) scroll.current.scrollTop = top;
      else window.scrollTo?.(0, top);
    }
  }, [selected, positionKey, pane]);
  function remember() {
    positions.set(
      positionKey,
      pane ? (scroll.current?.scrollTop ?? 0) : window.scrollY
    );
  }
  function change(values: Record<string, string | null>) {
    remember();
    setParams((current) => {
      const next = new URLSearchParams(current);
      [
        "message",
        "job",
        "draft",
        "replyDraft",
        "replyBackup",
        "move",
        "beforeMessage",
        "afterMessage",
      ].forEach((key) => next.delete(key));
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });
  }
  function close() {
    setParams((current) => {
      const next = new URLSearchParams(current);
      [
        "message",
        "job",
        "draft",
        "replyDraft",
        "replyBackup",
        "move",
        "beforeMessage",
        "afterMessage",
      ].forEach((key) => next.delete(key));
      return next;
    });
  }
  function open(row: MailSearchRow) {
    remember();
    setParams((current) => {
      const next = new URLSearchParams(current);
      [
        "message",
        "job",
        "draft",
        "replyDraft",
        "replyBackup",
        "move",
        "beforeMessage",
        "afterMessage",
      ].forEach((key) => next.delete(key));
      next.set(
        row.kind === "RECEIVED"
          ? "message"
          : row.kind === "SENT"
            ? "job"
            : "draft",
        row.id
      );
      return next;
    });
  }
  function renderRow(row: MailSearchRow) {
    return (
      <div
        className={cn(
          "min-w-0 space-y-1 py-2",
          (row.id === messageId || row.id === jobId || row.id === draftId) &&
            "rounded-control bg-accent px-2"
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <span
            className={cn(
              "min-w-0 truncate text-ui",
              !row.read && "font-semibold"
            )}
          >
            {row.kind === "RECEIVED"
              ? row.fromName || row.fromEmail
              : `To: ${row.to.join(", ") || "No recipients yet"}`}
          </span>
          <time className="shrink-0 text-meta text-text-tertiary">
            {formatMailDate(row.at)}
          </time>
        </div>
        <p className="truncate text-ui font-medium">
          {row.subject || "(no subject)"}
        </p>
        <p className="truncate text-meta text-text-secondary">
          {preview(row.preview) || "No preview available"}
        </p>
        <div className="flex min-w-0 items-center gap-2">
          <Badge
            className="max-w-full whitespace-normal"
            variant={
              row.status === "UNCERTAIN" || row.status === "FAILED"
                ? "warn"
                : "neutral"
            }
          >
            {status(row)}
          </Badge>
          <span className="truncate text-meta text-text-tertiary">
            {row.mailboxEmail || "Account removed"}
          </span>
        </div>
      </div>
    );
  }
  const columns = useMemo<ColumnDef<MailSearchRow, unknown>[]>(
    () => [
      {
        id: "mail",
        header: "Mail",
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => (
          <button
            type="button"
            className="w-full min-w-0 rounded-control text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Open ${row.original.subject || "untitled message"}`}
            onClick={(event) => {
              event.stopPropagation();
              open(row.original);
            }}
          >
            {renderRow(row.original)}
          </button>
        ),
      },
    ],
    [messageId, jobId, draftId]
  );
  const list = (
    <>
      <header className="sticky top-sticky-top z-10 space-y-3 border-b border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-section font-semibold">{title}</h1>
          <IconButton
            label={`Refresh ${title}`}
            onClick={() => void mail.refetch()}
            disabled={mail.isFetching}
          >
            <RefreshCw />
          </IconButton>
        </div>
        <Input
          aria-label={
            view === "ALL" ? "Search received and sent mail" : `Search ${title}`
          }
          placeholder={
            view === "ALL"
              ? "Search received and sent mail"
              : `Search ${title.toLowerCase()}`
          }
          value={input}
          maxLength={200}
          onChange={(event) => setInput(event.target.value)}
        />
        <Select
          value={mailbox || "all"}
          onValueChange={(value) =>
            change({ address: value === "all" ? null : value })
          }
        >
          <SelectTrigger aria-label="Search mailbox">
            <SelectValue placeholder="All assigned mailboxes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All assigned mailboxes</SelectItem>
            {mailbox &&
            !accounts.data?.some((account) => account.email === mailbox) ? (
              <SelectItem value={mailbox}>{mailbox} (unavailable)</SelectItem>
            ) : null}
            {(accounts.data ?? []).map((account) => (
              <SelectItem key={account.email} value={account.email}>
                {account.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {accounts.isError ? (
          <p className="text-meta">
            Couldn't load mailbox choices.{" "}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void accounts.refetch()}
            >
              Retry mailbox choices
            </Button>
          </p>
        ) : null}
        {mail.isError && mail.data ? (
          <p role="alert" className="text-meta">
            Showing cached mail. Refresh to try loading the latest messages.
          </p>
        ) : null}
        {view === "SENT" ? (
          <Link
            className="text-meta underline underline-offset-2"
            to={`/sent/activity${location.search}`}
          >
            Delivery reports and filters
          </Link>
        ) : null}
        {view === "OUTBOX" ? (
          <div className="space-y-2">
            <p className="text-meta text-text-secondary">
              Emails you composed, accepted and waiting to send. Unconfirmed
              outcomes stay in Sent.
            </p>
            <Link
              className="text-meta underline underline-offset-2"
              to="/outbox/manage"
            >
              Other delivery jobs
            </Link>
          </div>
        ) : view === "DRAFTS" ? (
          <p className="text-meta text-text-secondary">
            Your personal drafts and drafts imported from assigned mailboxes.
          </p>
        ) : null}
      </header>
      {mail.isError && !mail.data ? (
        <EmptyState
          title="Couldn't load this mail"
          description="Your messages are kept. Try loading again."
          action={
            <Button onClick={() => void mail.refetch()}>Try again</Button>
          }
        />
      ) : (
        <DataGrid
          label={`${title} messages`}
          className="[&_table]:table-fixed"
          data={rows}
          columns={columns}
          getRowId={(row) => `${row.kind}:${row.id}`}
          loading={mail.isPending}
          searchable={false}
          paginated={false}
          stickyHeader={false}
          onRowClick={open}
          getRowLabel={(row) => `Open ${row.subject || "untitled message"}`}
          renderMobileRow={renderRow}
          empty={
            <EmptyState
              icon={
                view === "DRAFTS" ? FileEdit : view === "OUTBOX" ? Send : Search
              }
              title={
                q
                  ? "No matching mail"
                  : view === "ALL"
                    ? "Search your mail"
                    : "No messages here"
              }
              description={
                q
                  ? "Try another phrase or choose another mailbox."
                  : "Messages appear here when they are available to your account."
              }
            />
          }
        />
      )}
      {mail.hasNextPage ? (
        <div className="p-4">
          <Button
            variant="secondary"
            disabled={mail.isFetchingNextPage}
            onClick={() => void mail.fetchNextPage()}
          >
            {mail.isFetchingNextPage ? <Spinner /> : null}Load older mail
          </Button>
        </div>
      ) : null}
    </>
  );
  const pendingJob = rows.find((row) => row.id === jobId);
  const back = (
    <div className="border-b border-border p-3">
      <Button variant="ghost" onClick={close}>
        <ArrowLeft />
        Back to {title}
      </Button>
    </div>
  );
  const reader = messageId ? (
    <InboxReader key={messageId} embedded backLabel={title} />
  ) : jobId ? (
    <>
      {pendingJob && ["PENDING", "QUEUED"].includes(pendingJob.status ?? "") ? (
        <div className="flex justify-end border-b border-border p-3">
          <Button variant="secondary" onClick={() => setCancelId(jobId)}>
            <X />
            Cancel remaining deliveries
          </Button>
        </div>
      ) : null}
      <OutgoingReader
        key={jobId}
        messageId={jobId}
        embedded
        backLabel={title}
        onBack={close}
      />
    </>
  ) : draftId ? (
    <>
      {back}
      <div className="space-y-4 p-4 sm:p-6">
        {draft.isPending ? (
          <Spinner />
        ) : draft.isError ? (
          <EmptyState
            title="Couldn't open this draft"
            description="Your saved writing is kept."
            action={
              <Button onClick={() => void draft.refetch()}>
                Try opening again
              </Button>
            }
          />
        ) : draft.data ? (
          <>
            <h2 className="text-title font-semibold">
              {draft.data.subject || "(no subject)"}
            </h2>
            <p className="break-words text-ui">
              To:{" "}
              {[...draft.data.to, ...draft.data.cc, ...draft.data.bcc].join(
                ", "
              ) || "No recipients yet"}
            </p>
            <p className="text-meta">
              {draft.data.completedSendId
                ? "Already accepted for delivery · writing kept"
                : "Personal draft · saved writing"}
            </p>
            <EmailPreviewFrame
              html={draft.data.html ?? ""}
              title="Saved draft preview"
            />
            {(draft.data.attachments ?? []).map((file) => (
              <p className="text-ui" key={file.id}>
                {file.filename}
              </p>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() =>
                  navigate(
                    draft.data!.completedSendId
                      ? `/sent?job=${encodeURIComponent(draft.data!.completedSendId)}`
                      : draft.data!.inboundMessageId
                        ? `/inbox?message=${encodeURIComponent(draft.data!.inboundMessageId!)}&replyDraft=${encodeURIComponent(draftId)}`
                        : `/email-studio?draft=${encodeURIComponent(draftId)}`
                  )
                }
              >
                <FileEdit />
                {draft.data.completedSendId
                  ? "Review accepted message"
                  : "Keep writing"}
              </Button>
              <Button variant="secondary" onClick={() => setRemoveId(draftId)}>
                <Trash2 />
                Remove draft
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </>
  ) : (
    <div className="flex min-h-80 items-center justify-center p-8 text-text-secondary">
      Select a message to read it.
    </div>
  );
  return (
    <>
      <div
        className={
          pane
            ? "grid h-[calc(100dvh-var(--mail-notice-height,0px))] grid-cols-[22.5rem_minmax(0,1fr)] 2xl:grid-cols-[25rem_minmax(0,1fr)]"
            : "min-w-0"
        }
      >
        {!selected || pane ? (
          <div
            ref={scroll}
            role="region"
            onScroll={(event) => {
              if (pane)
                positions.set(positionKey, event.currentTarget.scrollTop);
            }}
            tabIndex={-1}
            className={cn(
              "min-w-0",
              // scroll-exception: approved desktop mail list scrolls independently beside the reader.
              pane && "min-h-0 overflow-y-auto border-r border-border"
            )}
            aria-label="Mail list"
          >
            {list}
          </div>
        ) : null}
        {selected || pane ? (
          <section
            className={cn(
              "min-w-0",
              // scroll-exception: approved desktop conversation scroll stays beside the mail list.
              pane && "min-h-0 overflow-y-auto"
            )}
            ref={readerRegion}
            tabIndex={-1}
            aria-label="Reading pane"
          >
            <Suspense
              fallback={
                <div className="p-6">
                  <Spinner />
                </div>
              }
            >
              {reader}
            </Suspense>
          </section>
        ) : null}
      </div>
      <ConfirmDialog
        open={Boolean(cancelId)}
        onOpenChange={(open) => {
          if (!open) setCancelId(undefined);
        }}
        title="Cancel remaining deliveries?"
        description="Anything already handed to the mail server cannot be recalled. Your writing and recipient outcomes stay available."
        confirmLabel="Cancel remaining deliveries"
        onConfirm={() => cancelId && cancel.mutate(cancelId)}
        loading={cancel.isPending}
      />
      <ConfirmDialog
        open={Boolean(removeId)}
        onOpenChange={(open) => {
          if (!open) setRemoveId(undefined);
        }}
        title="Remove this draft?"
        description="This removes the personal draft from your active list."
        confirmLabel="Remove draft"
        onConfirm={() => removeId && remove.mutate(removeId)}
        loading={remove.isPending}
      />
    </>
  );
}
