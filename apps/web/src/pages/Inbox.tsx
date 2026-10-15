import { useEffect, useMemo, useState, useRef } from "react";
import { getSession } from "../lib/session.js";
import { useReadingPreference } from "../lib/reading-preference.js";
import { useMediaQuery } from "../lib/use-media-query.js";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Inbox as InboxIcon,
  Mail,
  MailPlus,
  Paperclip,
  RefreshCw,
  Reply,
  Forward,
  Trash2,
  Flag,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "../components/EmptyState.js";
import { InboundHtmlFrame } from "../components/InboundHtmlFrame.js";
import { ConnectInboxDialog } from "../components/inbox/ConnectInboxDialog.js";
import {
  AttachmentPreviewDialog,
  attachmentPreviewKind,
  downloadBlob,
} from "../components/inbox/AttachmentPreviewDialog.js";
import {
  api,
  type InboundAttachment,
  type InboundMessage,
  type MailboxView,
} from "../lib/api.js";
import { formatFullDate, formatMailDate, formatBytes } from "../lib/format.js";
import { useInboundInlineImages } from "../lib/inbound-inline-images.js";
import { qk } from "../lib/query-client.js";
import {
  useApiMutation,
  useOrgQuery,
  useOrgInfiniteQuery,
} from "../lib/use-api.js";
import { useSession } from "../lib/session-context.js";
import { cn } from "../lib/utils.js";
import { Avatar } from "../components/ui/avatar.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { IconButton } from "../components/ui/icon-button.js";
import { Input } from "../components/ui/input.js";
import { Spinner } from "../components/ui/spinner.js";
import { DataGrid } from "../components/ui/data-grid.js";
import { RowActions } from "../components/ui/row-actions.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { MoveControls } from "../components/inbox/MoveControls.js";
import { ReplyComposer } from "../components/inbox/ReplyComposer.js";
import { Hint } from "../components/ui/tooltip.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";

type ReadFilter = "all" | "unread" | "read";
const folderLabels: Record<MailboxView, string> = {
  INBOX: "Inbox",
  SENT: "Mailbox Sent",
  DRAFTS: "Mailbox Drafts",
  ARCHIVE: "Archive",
  TRASH: "Trash",
  JUNK: "Junk",
  OTHER: "Other folders",
  ALL: "All mailbox mail",
  FLAGGED: "Flagged",
};

interface ConversationThread {
  threadKey: string;
  messages: InboundMessage[];
  latestMessage: InboundMessage;
  senderName: string;
  senderEmail: string;
  subject: string;
  unreadCount: number;
}

function senderName(message: InboundMessage) {
  return message.fromName || message.fromEmail;
}

function senderLabel(message: InboundMessage) {
  return message.fromName
    ? `${message.fromName} <${message.fromEmail}>`
    : message.fromEmail;
}

function snippet(message: InboundMessage) {
  const text = message.text?.replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 180);
  if (!message.html) return "No preview available";
  // HTML-only message: derive a preview instead of showing a placeholder. This
  // is a list snippet rendered as a plain text node, never as markup, so
  // stripping tags crudely is enough — script/style contents are dropped first
  // so their source doesn't surface as "preview text".
  const stripped = message.html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  return stripped ? stripped.slice(0, 180) : "No preview available";
}

function threadKeyForMessage(message: InboundMessage) {
  return `${message.inboxAccountId}:${
    message.references[0] ??
    message.inReplyTo ??
    message.emailJob?.messageId ??
    message.messageId
  }`;
}

function compareMessages(a: InboundMessage, b: InboundMessage) {
  const delta =
    new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime();
  return delta !== 0 ? delta : a.id.localeCompare(b.id);
}

function buildConversationThreads(messages: InboundMessage[]) {
  const threads = new Map<string, ConversationThread>();

  for (const message of messages) {
    const threadKey = threadKeyForMessage(message);
    const current = threads.get(threadKey);

    if (!current) {
      threads.set(threadKey, {
        threadKey,
        messages: [message],
        latestMessage: message,
        senderName: senderName(message),
        senderEmail: message.fromEmail,
        subject: message.subject || "(no subject)",
        unreadCount: message.readAt ? 0 : 1,
      });
      continue;
    }

    current.messages.push(message);
    current.messages.sort(compareMessages);
    current.latestMessage =
      current.messages[current.messages.length - 1] ?? current.latestMessage;
    current.senderName = senderName(current.latestMessage);
    current.senderEmail = current.latestMessage.fromEmail;
    current.subject = current.latestMessage.subject || current.subject;
    current.unreadCount += message.readAt ? 0 : 1;
  }

  return [...threads.values()]
    .sort(
      (a, b) =>
        new Date(b.latestMessage.receivedAt).getTime() -
        new Date(a.latestMessage.receivedAt).getTime()
    )
    .map((thread) => ({
      ...thread,
      messages: [...thread.messages].sort(compareMessages),
    }));
}

/**
 * The inbox — the app's home screen.
 *
 * One screen at a time, the way Gmail does it: the conversation list owns the
 * full width of the page, and opening a conversation *replaces* it with the
 * reader instead of squeezing both into a split. The two-pane version put the
 * list in a 22rem rail and the message in whatever was left, which meant a
 * desktop reader narrower than the phone one and a list too cramped to show a
 * sender, a subject and its preview on one line. Now the row reads like a mail
 * client's — sender, subject, preview, date across a single line above `sm`,
 * stacked below it — and the message gets the whole measure.
 *
 * Nothing is open until it is tapped: there is no auto-selected first
 * conversation, so arriving at the inbox never marks a message read.
 */
export function Inbox() {
  const { currentOrganizationId } = useSession();
  return <InboxWorkspace key={currentOrganizationId} />;
}

function InboxWorkspace() {
  const {
    user,
    currentOrganizationId: organizationId,
    currentOrganization,
    organizations,
    setCurrentOrganizationId,
  } = useSession();
  const canManageMailboxes =
    currentOrganization?.role === "OWNER" ||
    currentOrganization?.role === "ADMIN";
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const reading = useReadingPreference(user?.id ?? "signed-out");
  const desktop = useMediaQuery("(min-width: 1024px)");
  const readingPane = desktop && reading === "pane";
  const listScroll = useRef<HTMLDivElement>(null);
  const scrollPosition = useRef(0);
  function closeConversation() {
    setOpenedThread(null);
    setReplyTarget(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("message");
      next.delete("replyDraft");
      next.delete("move");
      return next;
    });
  }

  const accountFilter = searchParams.get("mailbox") ?? "all";
  const readParam = searchParams.get("read");
  const readFilter: ReadFilter =
    readParam === "read" || readParam === "unread" ? readParam : "all";
  const viewParam = searchParams.get("view") ?? "INBOX";
  const view = (
    Object.hasOwn(folderLabels, viewParam) ? viewParam : "INBOX"
  ) as MailboxView;
  const folderId = searchParams.get("folder") ?? undefined;
  const submittedSearch = searchParams.get("q") ?? "";
  const [search, setSearch] = useState(submittedSearch);
  useEffect(() => setSearch(submittedSearch), [submittedSearch]);
  function updateFilters(values: Record<string, string | undefined>) {
    setOpenedThread(null);
    setReplyTarget(null);
    scrollPosition.current = 0;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("message");
      next.delete("replyDraft");
      next.delete("move");
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });
  }
  const setAccountFilter = (value: string) =>
    updateFilters({
      mailbox: value === "all" ? undefined : value,
      folder: undefined,
    });
  const setReadFilter = (value: ReadFilter) =>
    updateFilters({ read: value === "all" ? undefined : value });
  const setSubmittedSearch = (value: string) => {
    if (value !== submittedSearch) updateFilters({ q: value || undefined });
  };
  /*
    The conversation being read, captured at the moment it was opened.

    Held as the thread itself rather than as a key into the list, because the
    list moves underneath it: opening a conversation marks it read, which
    refetches, and under the "unread" filter that drops the very thread being
    read. A key would resolve to nothing and slam the reader shut mid-sentence.
    The live thread is preferred whenever it is still there, so a reply landing
    in the open conversation still appears.
  */
  const [openedThread, setOpenedThread] = useState<ConversationThread | null>(
    null
  );
  const [connectOpen, setConnectOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState<InboundMessage | null>(null);
  const navigate = useNavigate();
  const forwardIds = useRef(new Map<string, string>());
  const forward = useApiMutation(
    async (messageId: string) => {
      if (!organizationId) throw new Error("Select an organization first.");
      let clientId = forwardIds.current.get(messageId);
      if (!clientId) {
        clientId = crypto.randomUUID();
        forwardIds.current.set(messageId, clientId);
      }
      return api.prepareInboundForward(messageId, organizationId, clientId);
    },
    {
      errorMessage:
        "Couldn't prepare the forward. Your original message is kept.",
      onSuccess: (draft, messageId) => {
        forwardIds.current.delete(messageId);
        if (
          getSession().currentOrganizationId &&
          getSession().currentOrganizationId !== organizationId
        )
          return;
        navigate(`/email-studio?draft=${encodeURIComponent(draft.id)}`);
      },
    }
  );

  const [disconnectTarget, setDisconnectTarget] = useState<string | null>(null);
  const readMessages = useRef(new Set<string>());
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    attachment: InboundAttachment;
    blob: Blob;
  } | null>(null);

  const accountsQuery = useOrgQuery(
    organizationId,
    qk.inboxAccounts(organizationId ?? ""),
    (id) => api.listInboxAccounts(id)
  );

  const messageFilters = {
    q: submittedSearch,
    read: readFilter,
    inboxAccountId: accountFilter === "all" ? undefined : accountFilter,
    folderId,
    view,
  };
  const foldersQuery = useOrgQuery(
    organizationId,
    qk.inboxFolders(organizationId ?? "", messageFilters.inboxAccountId),
    (id) => api.listInboxFolders(id, messageFilters.inboxAccountId),
    { refetchInterval: 15_000 }
  );
  const messagesQuery = useOrgInfiniteQuery(
    organizationId,
    qk.inboundMessages(organizationId ?? "", messageFilters),
    (id, cursor) =>
      api.listInboundMessages({
        organizationId: id,
        q: submittedSearch || undefined,
        read: readFilter,
        inboxAccountId: messageFilters.inboxAccountId,
        folderId,
        view,
        cursor,
      })
  );
  const conversationQuery = useOrgQuery(
    organizationId,
    qk.inboxConversation(
      organizationId ?? "",
      searchParams.get("message") ?? openedThread?.latestMessage.id ?? ""
    ),
    (id) =>
      api.getInboxConversation(
        searchParams.get("message") ?? openedThread?.latestMessage.id ?? "",
        id
      ),
    {
      enabled: Boolean(openedThread || searchParams.get("message")),
      refetchInterval: 10_000,
    }
  );

  const accounts = useMemo(
    () => accountsQuery.data ?? [],
    [accountsQuery.data]
  );
  const messages = useMemo(
    () => messagesQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [messagesQuery.data]
  );

  const filteredMessages = useMemo(
    () =>
      accountFilter === "all"
        ? messages
        : messages.filter(
            (message) => message.inboxAccountId === accountFilter
          ),
    [messages, accountFilter]
  );
  const threads = useMemo(
    () => buildConversationThreads(filteredMessages),
    [filteredMessages]
  );
  const selectedThread = useMemo(() => {
    if (!openedThread) return null;
    const full = conversationQuery.data?.messages;
    if (full?.length) {
      const sorted = [...full].sort(compareMessages);
      const latestMessage = sorted[sorted.length - 1];
      return {
        ...openedThread,
        messages: sorted,
        latestMessage,
        unreadCount: sorted.filter((message) => !message.readAt).length,
      };
    }
    return (
      threads.find((thread) => thread.threadKey === openedThread.threadKey) ??
      openedThread
    );
  }, [threads, openedThread, conversationQuery.data]);

  const unreadCount = filteredMessages.filter(
    (message) => !message.readAt
  ).length;

  // Only the open thread's inline parts are fetched — the list renders no
  // bodies, so downloading blobs for every message would be wasted bandwidth.
  const inlineImages = useInboundInlineImages(
    useMemo(() => selectedThread?.messages ?? [], [selectedThread]),
    organizationId ?? null
  );

  const markRead = useApiMutation(
    (input: { id: string; read: boolean }) =>
      api.markInboundMessageRead(input.id, {
        organizationId: organizationId as string,
        read: input.read,
      }),
    {
      errorMessage: "Couldn't update that message.",
      invalidates: () => [
        ["inbound-messages", organizationId ?? ""],
        // The nav badge reads its own query; keep the two in step.
        qk.inboxUnreadCount(organizationId ?? ""),
      ],
    }
  );
  const flag = useApiMutation(
    (message: InboundMessage) =>
      api.markInboundMessageFlagged(
        message.id,
        organizationId as string,
        !message.flagged
      ),
    {
      invalidates: [
        ["inbound-messages", organizationId ?? ""],
        ["inbox-conversation", organizationId ?? ""],
      ],
    }
  );

  const removeAccount = useApiMutation(
    (accountId: string) =>
      api.deleteInboxAccount(accountId, organizationId as string),
    {
      successMessage: "Mailbox disconnected.",
      errorMessage: "Couldn't disconnect that mailbox.",
      invalidates: [qk.inboxAccounts(organizationId ?? "")],
      onSuccess: () => setAccountFilter("all"),
    }
  );

  const markMany = useApiMutation(
    (input: { ids: string[]; read: boolean }) =>
      api.markInboundMessagesRead(
        organizationId as string,
        input.ids,
        input.read
      ),
    {
      errorMessage: "Couldn't update these messages.",
      invalidates: [
        ["inbound-messages", organizationId ?? ""],
        qk.inboxUnreadCount(organizationId ?? ""),
      ],
      onSuccess: () => {
        readMessages.current.clear();
      },
    }
  );
  const sync = useApiMutation(
    () =>
      api.syncInbox(
        organizationId as string,
        accountFilter === "all" ? undefined : accountFilter
      ),
    {
      successMessage:
        "Checking your mailbox. New mail will appear automatically.",
      invalidates: [
        ["inbound-messages", organizationId ?? ""],
        qk.inboxAccounts(organizationId ?? ""),
      ],
    }
  );
  const retryFiles = useApiMutation(
    (messageId: string) =>
      api.retryInboundContent(messageId, organizationId as string),
    {
      successMessage:
        "Loading attachments again. Keep this conversation open to follow their status.",
      errorMessage: "Couldn't retry these files.",
      onSuccess: () => void conversationQuery.refetch(),
    }
  );

  function openThread(thread: ConversationThread) {
    scrollPosition.current = readingPane
      ? (listScroll.current?.scrollTop ?? 0)
      : window.scrollY;
    setOpenedThread(thread);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("message", thread.latestMessage.id);
      return next;
    });
    // Opening a conversation reads every message in it, the way a mail client
    // does — leaving older messages in a thread unread would keep the badge lit
    // with nothing left to click.
    thread.messages
      .filter((message) => !message.readAt)
      .forEach((message) => {
        readMessages.current.add(message.id);
        markRead.mutate({ id: message.id, read: true });
      });
  }

  // A notification can be about an org other than the one on screen — one
  // device now serves every org its owner belongs to — so the link names its
  // own. Switch first and let the message lookup below re-run against the right
  // inbox once it reloads; the parameter is only dropped once we are there, or
  // if the person is no longer a member of that org at all.
  useEffect(() => {
    const targetOrg = searchParams.get("org");
    if (!targetOrg) return;
    if (
      targetOrg !== organizationId &&
      organizations.some((candidate) => candidate.id === targetOrg)
    ) {
      setCurrentOrganizationId(targetOrg);
      return;
    }
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("org");
        return next;
      },
      { replace: true }
    );
  }, [
    searchParams,
    organizationId,
    organizations,
    setCurrentOrganizationId,
    setSearchParams,
  ]);

  // The URL owns selection: refresh, shared links and browser Back keep the
  // same conversation even when it falls out of the current filtered page.
  useEffect(() => {
    const target = searchParams.get("message");
    if (!target) {
      setOpenedThread(null);
      requestAnimationFrame(() => {
        if (readingPane && listScroll.current)
          listScroll.current.scrollTop = scrollPosition.current;
        else window.scrollTo?.(0, scrollPosition.current);
      });
      return;
    }
    const thread = threads.find((candidate) =>
      candidate.messages.some((message) => message.id === target)
    );
    if (thread) setOpenedThread(thread);
  }, [searchParams.get("message")]);

  useEffect(() => {
    const full = conversationQuery.data?.messages;
    if (full?.length && !openedThread && searchParams.get("message")) {
      const thread = buildConversationThreads(full)[0];
      if (thread) setOpenedThread(thread);
    }
    full
      ?.filter(
        (message) => !message.readAt && !readMessages.current.has(message.id)
      )
      .forEach((message) => {
        readMessages.current.add(message.id);
        markRead.mutate({ id: message.id, read: true });
      });
    if (searchParams.get("replyDraft") && full?.length && !replyTarget) {
      const target = full.find(
        (message) => message.id === searchParams.get("message")
      );
      if (target) setReplyTarget(target);
    }
  }, [conversationQuery.data]);

  // Escape leaves the conversation, the way it does in a mail client. Skipped
  // while an overlay is up — there the key belongs to the dialog — and while
  // the caret is in a field, where it belongs to whatever is being typed.
  useEffect(() => {
    if (!openedThread || connectOpen || preview) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, [contenteditable='true']"))
        return;
      closeConversation();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openedThread, connectOpen, preview]);

  /**
   * Open an attachment the way a mail client does: show it in place when it is
   * something the browser can render safely, and only fall back to saving it to
   * disk for formats it can't (documents, archives, anything scriptable).
   *
   * Either way the bytes come over the authenticated download route — inbound
   * files are never exposed publicly, so the file can't just be linked to.
   */
  async function openAttachment(
    messageId: string,
    file: InboundAttachment,
    outgoing = false
  ) {
    if (!organizationId) return;
    setOpeningId(file.id);
    try {
      const blob = outgoing
        ? await api.downloadAttachment(file.id)
        : await api.downloadInboundAttachment({
            messageId,
            attachmentId: file.id,
            organizationId,
          });
      if (attachmentPreviewKind(file.contentType)) {
        setPreview({ attachment: file, blob });
      } else {
        downloadBlob(blob, file.filename);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't open that file."
      );
      void conversationQuery.refetch();
    } finally {
      setOpeningId(null);
    }
  }

  const loading = accountsQuery.isPending || messagesQuery.isPending;
  // With a single mailbox there is no filter to pick it with, so treat it as
  // selected — otherwise its status and its Disconnect control would be
  // unreachable for the most common setup of all.
  const selectedAccount =
    accounts.find((account) => account.id === accountFilter) ??
    (accounts.length === 1 ? accounts[0] : undefined);

  function renderThread(thread: ConversationThread) {
    const unread = thread.unreadCount > 0;
    return (
      <button
        type="button"
        onClick={() => openThread(thread)}
        className={cn(
          "flex min-h-touch w-full items-start gap-3 rounded-control p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selectedThread?.threadKey === thread.threadKey
            ? "bg-brand/10 ring-1 ring-brand/20"
            : unread
              ? "bg-surface"
              : "bg-transparent"
        )}
      >
        {unread ? <span className="sr-only">Unread</span> : null}
        <Avatar name={thread.senderName} size="md" />
        <span className="min-w-0 flex-1">
          <span
            className={cn("block truncate text-ui", unread && "font-semibold")}
          >
            {thread.senderName}
          </span>
          <span
            className={cn("block truncate text-ui", unread && "font-semibold")}
          >
            {thread.subject}
          </span>
          <span className="block truncate text-meta text-text-tertiary">
            {snippet(thread.latestMessage)}
          </span>
          {thread.messages.some(
            (message) => message.dsnAttribution === "UNATTRIBUTED"
          ) ? (
            <Badge variant="warn">Unattributed</Badge>
          ) : null}
        </span>
        <span className="shrink-0 text-meta text-text-secondary">
          {formatMailDate(thread.latestMessage.receivedAt)}
        </span>
      </button>
    );
  }

  /*
    The document is the only scroll container (§2), so nothing here sets a
    height or an overflow: the screen grows to its content and the page
    scrolls, with each header held in place by `sticky` at the offset the shell
    publishes (which already accounts for the notch and the tablet top bar).

    `mx-auto max-w-page` goes on the inner wrappers rather than on the screen
    itself, so every rule and hairline still runs edge to edge while the rows
    and the message sit on the same measure as the rest of the app.
  */
  const reader = selectedThread ? (
    <>
      <header className="sticky top-sticky-top z-10 border-b border-border bg-surface">
        <div className="mx-auto w-full max-w-page px-4 py-3 sm:px-6">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={closeConversation}
              className="-ml-1 inline-flex min-h-touch items-center gap-field rounded-control px-1 text-ui font-medium text-text-secondary transition-colors duration-fast ease-out hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="h-4 w-4" />
              {folderLabels[view]}
            </button>

            <div className="ml-auto flex shrink-0 items-center gap-1">
              <IconButton
                label={
                  selectedThread.latestMessage.flagged
                    ? "Remove flag"
                    : "Flag message"
                }
                disabled={flag.isPending}
                onClick={() => flag.mutate(selectedThread.latestMessage)}
              >
                <Flag
                  className={
                    selectedThread.latestMessage.flagged
                      ? "fill-current text-primary"
                      : undefined
                  }
                />
              </IconButton>
              <IconButton
                label="Mark as unread"
                onClick={() => {
                  markRead.mutate({
                    id: selectedThread.latestMessage.id,
                    read: false,
                  });
                  // Back to the list, the way every mail client does it —
                  // otherwise the conversation you just marked unread is
                  // still open, and closing it later would mark it read.
                  closeConversation();
                }}
              >
                <Mail />
              </IconButton>
              <IconButton
                label="Reply"
                disabled={
                  selectedThread.latestMessage.bodyStatus === "UNAVAILABLE"
                }
                onClick={() => setReplyTarget(selectedThread.latestMessage)}
              >
                <Reply />
              </IconButton>
              <IconButton
                label="Forward"
                disabled={
                  forward.isPending ||
                  selectedThread.latestMessage.bodyStatus === "UNAVAILABLE"
                }
                onClick={() => forward.mutate(selectedThread.latestMessage.id)}
              >
                <Forward />
              </IconButton>
            </div>
          </div>

          <div className="mt-2 min-w-0">
            <h2 className="text-title font-semibold text-text">
              {selectedThread.subject}
            </h2>
            <p className="mt-1 truncate text-ui text-text-secondary">
              {selectedThread.senderName} · {selectedThread.senderEmail}
            </p>
            {selectedThread.latestMessage.flagPending ? (
              <p role="status" className="text-meta text-text-tertiary">
                {selectedThread.latestMessage.flagSyncError ??
                  "Flag change is waiting to sync with the mailbox."}
              </p>
            ) : null}
          </div>
        </div>
        <div className="mx-auto w-full max-w-page px-4 pb-3 sm:px-6">
          <MoveControls
            key={`${organizationId}:${searchParams.get("message") ?? selectedThread.latestMessage.id}`}
            messages={selectedThread.messages}
            anchorId={
              searchParams.get("message") ?? selectedThread.latestMessage.id
            }
            organizationId={organizationId as string}
            view={view}
            folderId={folderId}
          />
        </div>
      </header>

      <div className="mx-auto w-full max-w-page space-y-4 px-4 py-4 sm:px-6 sm:py-6">
        {conversationQuery.isError ? (
          <div
            role="alert"
            className="rounded-card border border-err p-4 text-ui"
          >
            Couldn't load the complete conversation.{" "}
            <Button
              variant="secondary"
              onClick={() => void conversationQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : null}
        {[
          ...selectedThread.messages.map((message) => ({
            kind: "incoming" as const,
            message,
            date: message.receivedAt,
          })),
          ...(conversationQuery.data?.outgoing ?? []).map((message) => ({
            kind: "outgoing" as const,
            message,
            date: message.sentAt ?? message.createdAt,
          })),
        ]
          .sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
          )
          .map((entry) => {
            if (entry.kind === "outgoing") {
              const message = entry.message;
              return (
                <article
                  key={message.id}
                  className="rounded-card border border-border bg-surface p-4 shadow-card"
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-ui font-medium">
                      {message.sentByName} ·{" "}
                      {message.smtpConnection?.fromEmail ?? "Your team"}
                    </p>
                    <Badge
                      variant={message.status === "FAILED" ? "warn" : "outline"}
                    >
                      {message.status === "SENT"
                        ? "Sent"
                        : message.status === "FAILED"
                          ? "Failed — check Sent for details"
                          : message.status === "UNCERTAIN"
                            ? "Delivery unconfirmed — check before sending again"
                            : message.status === "SUPPRESSED"
                              ? "Not sent — recipient blocked"
                              : message.status === "CANCELLED"
                                ? "Cancelled"
                                : "Sending…"}
                    </Badge>
                  </div>
                  <p className="mb-2 text-meta text-text-secondary">
                    To: {message.toEmail} ·{" "}
                    {formatFullDate(message.sentAt ?? message.createdAt)}
                  </p>
                  {message.html ? (
                    <InboundHtmlFrame
                      html={message.html}
                      showRemoteContent
                      title="Your reply"
                    />
                  ) : (
                    <p className="whitespace-pre-wrap">{message.text}</p>
                  )}
                  {(message.attachments ?? [])
                    .filter((file) => !file.isInline)
                    .map((file) => (
                      <Button
                        key={file.id}
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        disabled={openingId === file.id}
                        onClick={() =>
                          void openAttachment(message.id, file, true)
                        }
                      >
                        <Paperclip />
                        {file.filename} · {formatBytes(file.size)}
                      </Button>
                    ))}
                </article>
              );
            }
            const message = entry.message;
            return (
              <article
                key={message.id}
                className="rounded-card border border-border bg-surface p-4 shadow-card"
              >
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar name={senderName(message)} size="sm" />
                    <div className="min-w-0">
                      <div className="truncate text-ui font-semibold text-text">
                        {senderLabel(message)}
                      </div>
                      <div
                        className="text-meta text-text-tertiary"
                        data-numeric
                      >
                        {formatFullDate(message.receivedAt)}
                      </div>
                    </div>
                  </div>
                  <IconButton
                    label={`Reply to this message from ${senderName(message)}`}
                    disabled={message.bodyStatus === "UNAVAILABLE"}
                    onClick={() => setReplyTarget(message)}
                  >
                    <Reply />
                  </IconButton>
                  <IconButton
                    label={`Forward this message from ${senderName(message)}`}
                    disabled={
                      forward.isPending || message.bodyStatus === "UNAVAILABLE"
                    }
                    onClick={() => forward.mutate(message.id)}
                  >
                    <Forward />
                  </IconButton>
                  {message.emailJob ? (
                    <Hint
                      label={`This is a reply to the email "${message.emailJob.subject}" that you sent`}
                    >
                      <Badge variant="outline" className="cursor-help">
                        Reply to your email
                      </Badge>
                    </Hint>
                  ) : null}
                  {message.dsnAttribution === "UNATTRIBUTED" ? (
                    <Hint label="This delivery failure does not match an email sent through QQueue, so it is excluded from bounce analytics.">
                      <Badge variant="warn" className="cursor-help">
                        Unattributed bounce
                      </Badge>
                    </Hint>
                  ) : null}
                </div>

                <details className="mb-3 text-meta text-text-secondary">
                  <summary className="cursor-pointer">Message details</summary>
                  {message.readPending ? (
                    <p
                      role="status"
                      className={
                        message.readSyncError
                          ? "text-err"
                          : "text-text-secondary"
                      }
                    >
                      {message.readSyncError ??
                        "Read state saved for your team; waiting to sync with the mail server."}
                    </p>
                  ) : null}
                  <p>To: {message.to.join(", ")}</p>
                  {message.cc.length ? (
                    <p>Cc: {message.cc.join(", ")}</p>
                  ) : null}
                  {message.replyTo?.length ? (
                    <p>Reply to: {message.replyTo.join(", ")}</p>
                  ) : null}
                  <p>
                    Mailbox:{" "}
                    {
                      accounts.find(
                        (account) => account.id === message.inboxAccountId
                      )?.email
                    }
                  </p>
                </details>
                {/*
                  Prefer the HTML part — formatted mail (tables especially)
                  reads badly as the flattened text/plain alternative.
                */}
                {message.html ? (
                  <InboundHtmlFrame
                    html={message.html}
                    /*
                      Remote images load without an opt-in. Most mail is
                      image-heavy and a blocked-image prompt on every message
                      made the inbox unreadable; the tradeoff is that opening
                      a message can fire the sender's tracking pixel, exactly
                      as it does in Gmail's default configuration. The frame
                      still refuses scripts, frames and network fetches — only
                      img-src is widened.
                    */
                    showRemoteContent
                    inlineImages={inlineImages[message.id]}
                    title={`Message from ${senderLabel(message)}`}
                  />
                ) : (
                  <div className="whitespace-pre-wrap text-body leading-6 text-text">
                    {message.text || "This message has no body."}
                  </div>
                )}

                {/*
                  Attached parts. Inline parts (cid: images the sender meant
                  to render in the body) are filtered out so a signature logo
                  doesn't look like an attachment.
                */}
                {(message.attachments ?? []).filter(
                  (file) =>
                    !file.isInline ||
                    (file.storageStatus && file.storageStatus !== "AVAILABLE")
                ).length > 0 ? (
                  <div className="mt-4 border-t border-border pt-3">
                    <div className="mb-2 text-meta font-medium uppercase tracking-eyebrow text-text-tertiary">
                      Attachments
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(message.attachments ?? [])
                        .filter(
                          (file) =>
                            !file.isInline ||
                            (file.storageStatus &&
                              file.storageStatus !== "AVAILABLE")
                        )
                        .map((file) => (
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
                              disabled={
                                openingId === file.id ||
                                Boolean(
                                  file.storageStatus &&
                                  file.storageStatus !== "AVAILABLE"
                                )
                              }
                              onClick={() =>
                                void openAttachment(message.id, file)
                              }
                              className="h-auto gap-2 py-field"
                            >
                              {openingId === file.id ? (
                                <Spinner className="h-3.5 w-3.5" />
                              ) : (
                                <Paperclip className="h-3.5 w-3.5" />
                              )}
                              <span className="max-w-cell truncate">
                                {file.filename}
                              </span>
                              <span
                                className="text-meta text-text-tertiary"
                                data-numeric
                              >
                                {formatBytes(file.size)}
                              </span>
                            </Button>
                          </Hint>
                        ))}
                    </div>
                  </div>
                ) : null}
                {message.contentImportPending ||
                (message.attachments ?? []).some(
                  (file) =>
                    file.storageStatus && file.storageStatus !== "AVAILABLE"
                ) ? (
                  <div
                    role="alert"
                    className="mt-3 space-y-2 text-ui text-warn"
                  >
                    <p>
                      {message.bodyStatus === "UNAVAILABLE"
                        ? (message.bodyError ??
                          "This message body is still loading.")
                        : "Some attachments are still loading or need attention."}
                    </p>
                    {(message.attachments ?? [])
                      .filter((file) => file.storageError)
                      .map((file) => (
                        <p key={file.id}>
                          {file.filename}: {file.storageError}
                        </p>
                      ))}
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={retryFiles.isPending}
                      onClick={() => retryFiles.mutate(message.id)}
                    >
                      {message.bodyStatus === "UNAVAILABLE"
                        ? "Reload message and files"
                        : "Retry loading attachments"}
                    </Button>
                  </div>
                ) : null}
              </article>
            );
          })}

        <Button
          variant="secondary"
          disabled={selectedThread.latestMessage.bodyStatus === "UNAVAILABLE"}
          onClick={() => setReplyTarget(selectedThread.latestMessage)}
        >
          <Reply /> Write a reply
        </Button>
      </div>
    </>
  ) : (
    <div className="hidden min-h-96 items-center justify-center p-8 text-text-secondary lg:flex">
      Select a conversation to read it.
    </div>
  );
  const mailList = (
    <>
      <header className="sticky top-sticky-top z-10 border-b border-border bg-surface">
        <div className="mx-auto w-full max-w-page px-4 pb-3 pt-4 sm:px-6">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-section font-semibold text-text">
                {folderId
                  ? (foldersQuery.data?.find((folder) => folder.id === folderId)
                      ?.name ?? "Folder")
                  : folderLabels[view]}
              </h1>
              <p className="text-meta text-text-tertiary" data-numeric>
                {unreadCount > 0
                  ? `${unreadCount} unread of ${filteredMessages.length}`
                  : `${filteredMessages.length} message${filteredMessages.length === 1 ? "" : "s"}`}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <IconButton
                label="Check for new mail"
                onClick={() => sync.mutate()}
                disabled={sync.isPending}
              >
                <RefreshCw
                  className={cn(messagesQuery.isFetching && "animate-spin")}
                />
              </IconButton>
              {canManageMailboxes ? (
                <IconButton
                  label="Connect a mailbox"
                  onClick={() => setConnectOpen(true)}
                  disabled={!organizationId}
                >
                  <MailPlus />
                </IconButton>
              ) : null}
            </div>
          </div>

          {/*
                Search, filters and the mailbox status share one wrapping row
                now that the list owns the full width. In the old 22rem rail
                they had to stack: a segmented control beside a mailbox picker
                put both below the 44px touch minimum (§5). They still wrap to
                their own lines on a phone, where the search box goes full
                width and the rest follows underneath.
              */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Select
              value={folderId ? `folder:${folderId}` : `view:${view}`}
              onValueChange={(value) => {
                updateFilters(
                  value.startsWith("folder:")
                    ? { folder: value.slice(7) }
                    : {
                        folder: undefined,
                        view:
                          value.slice(5) === "INBOX"
                            ? undefined
                            : value.slice(5),
                      }
                );
              }}
            >
              <SelectTrigger aria-label="Choose mail folder" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  [
                    "INBOX",
                    "ARCHIVE",
                    "TRASH",
                    "SENT",
                    "DRAFTS",
                    "JUNK",
                    "FLAGGED",
                    "ALL",
                  ] as const
                ).map((value) => (
                  <SelectItem key={value} value={`view:${value}`}>
                    {folderLabels[value]}
                  </SelectItem>
                ))}
                {(foldersQuery.data ?? [])
                  .filter((folder) => folder.present || folder.id === folderId)
                  .map((folder) => (
                    <SelectItem
                      key={folder.id}
                      value={`folder:${folder.id}`}
                      disabled={!folder.present}
                    >
                      {folder.path} ·{" "}
                      {accounts.find(
                        (account) => account.id === folder.inboxAccountId
                      )?.email ?? "Mailbox"}
                      {folder.present ? "" : " (unavailable)"}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {foldersQuery.isError ? (
              <p role="alert" className="text-meta text-err">
                Couldn't load folders.{" "}
                <Button
                  variant="ghost"
                  onClick={() => void foldersQuery.refetch()}
                >
                  Try again
                </Button>
              </p>
            ) : null}
            {folderId &&
            foldersQuery.data?.find((folder) => folder.id === folderId)
              ?.lastSyncError ? (
              <p role="alert" className="text-meta text-err">
                {
                  foldersQuery.data.find((folder) => folder.id === folderId)
                    ?.lastSyncError
                }
              </p>
            ) : null}
            <form
              className="w-full sm:w-auto"
              onSubmit={(event) => {
                event.preventDefault();
                setSubmittedSearch(search.trim());
              }}
            >
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onBlur={() => setSubmittedSearch(search.trim())}
                identifier
                placeholder="Search mail"
                aria-label="Search mail"
                type="search"
                width="search"
              />
            </form>

            <div className="flex rounded-control border border-border bg-surface-sunken p-1">
              {(["all", "unread", "read"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setReadFilter(value)}
                  aria-pressed={readFilter === value}
                  className={cn(
                    "min-h-touch rounded-control px-3 text-ui font-medium capitalize transition-colors duration-fast ease-out sm:min-h-0 sm:py-field",
                    readFilter === value
                      ? "bg-surface text-text shadow-card"
                      : "text-text-secondary hover:text-text"
                  )}
                >
                  {value}
                </button>
              ))}
            </div>

            {accounts.length > 1 ? (
              <Select value={accountFilter} onValueChange={setAccountFilter}>
                <SelectTrigger
                  aria-label="Filter by mailbox"
                  className="w-field-choice"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All mailboxes</SelectItem>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}

            {selectedAccount ? (
              <div className="flex min-w-0 items-center gap-2 text-meta text-text-tertiary sm:ml-auto">
                <Badge variant="outline" className="text-meta">
                  {selectedAccount.status === "DISABLED"
                    ? "Disconnected"
                    : selectedAccount.lastSyncError
                      ? "Needs attention"
                      : "Connected"}
                </Badge>
                {selectedAccount.lastSyncError ? (
                  <span role="alert" className="text-err">
                    {selectedAccount.lastSyncError}
                  </span>
                ) : null}
                <span className="truncate">
                  Last checked {formatFullDate(selectedAccount.lastSyncedAt)}
                </span>
                {selectedAccount.status === "ACTIVE" &&
                (selectedAccount.historyBeforeUid === null ||
                  (selectedAccount.historyBeforeUid ?? 0) > 0) ? (
                  <span className="text-meta">
                    Older mail is importing in the background.
                  </span>
                ) : null}
                {canManageMailboxes ? (
                  <IconButton
                    label={`Disconnect ${selectedAccount.email}`}
                    size="sm"
                    variant="destructive"
                    onClick={() => setDisconnectTarget(selectedAccount.id)}
                  >
                    <Trash2 />
                  </IconButton>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-page">
        {accountsQuery.isError || messagesQuery.isError ? (
          <EmptyState
            title="Couldn't load your mail"
            description="Your mailbox may still contain messages. Try loading it again."
            action={
              <Button
                onClick={() => {
                  void accountsQuery.refetch();
                  void messagesQuery.refetch();
                }}
              >
                Try again
              </Button>
            }
          />
        ) : loading ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        ) : accounts.length === 0 ? (
          <EmptyState
            icon={MailPlus}
            title={
              canManageMailboxes
                ? "No mailbox connected"
                : "No mailbox assigned yet"
            }
            description={
              canManageMailboxes
                ? "Connect a mailbox to receive mail here."
                : "Ask an administrator to assign you a mailbox."
            }
            action={
              canManageMailboxes ? (
                <Button
                  variant="secondary"
                  onClick={() => setConnectOpen(true)}
                >
                  <MailPlus className="h-4 w-4" />
                  Connect a mailbox
                </Button>
              ) : undefined
            }
          />
        ) : threads.length === 0 ? (
          <EmptyState
            icon={InboxIcon}
            title={
              submittedSearch
                ? "Nothing matched"
                : readFilter === "unread"
                  ? "You’re all caught up"
                  : "No conversations yet"
            }
            description={
              submittedSearch
                ? "Try a different search, or clear it to see everything."
                : "New mail will appear here after your mailbox is checked."
            }
          />
        ) : (
          <DataGrid
            label="Inbox conversations"
            className="[&_table]:table-fixed [&_th:first-child]:w-12 [&_th:last-child]:w-12"
            stickyHeader={false}
            data={threads}
            getRowId={(thread) => thread.threadKey}
            columns={[
              {
                id: "conversation",
                header: "Conversation",
                enableSorting: false,
                enableHiding: false,
                cell: ({ row }) => renderThread(row.original),
              },
              {
                id: "actions",
                header: "",
                enableSorting: false,
                meta: { pinned: true },
                cell: ({ row }) => (
                  <RowActions
                    rowLabel={row.original.subject}
                    actions={[
                      {
                        label: row.original.unreadCount
                          ? "Mark as read"
                          : "Mark as unread",
                        icon: Mail,
                        primary: true,
                        onSelect: () =>
                          markMany.mutate({
                            ids: row.original.messages.map(
                              (message) => message.id
                            ),
                            read: row.original.unreadCount > 0,
                          }),
                      },
                      {
                        label: row.original.latestMessage.flagged
                          ? "Remove flag"
                          : "Flag message",
                        icon: Flag,
                        onSelect: () => flag.mutate(row.original.latestMessage),
                      },
                    ]}
                  />
                ),
              },
            ]}
            searchable={false}
            enableSelection
            paginated={false}
            renderMobileRow={renderThread}
            bulkActions={(rows, clear) => (
              <>
                <Button
                  variant="secondary"
                  disabled={markMany.isPending}
                  onClick={() =>
                    markMany.mutate(
                      {
                        ids: rows.flatMap((thread) =>
                          thread.messages.map((message) => message.id)
                        ),
                        read: true,
                      },
                      { onSuccess: clear }
                    )
                  }
                >
                  Mark selected as read
                </Button>
                <Button
                  variant="secondary"
                  disabled={markMany.isPending}
                  onClick={() =>
                    markMany.mutate(
                      {
                        ids: rows.flatMap((thread) =>
                          thread.messages.map((message) => message.id)
                        ),
                        read: false,
                      },
                      { onSuccess: clear }
                    )
                  }
                >
                  Mark selected as unread
                </Button>
              </>
            )}
          />
        )}
        {messagesQuery.hasNextPage ? (
          <div className="p-4 text-center">
            <Button
              variant="secondary"
              disabled={messagesQuery.isFetchingNextPage}
              onClick={() => void messagesQuery.fetchNextPage()}
            >
              {messagesQuery.isFetchingNextPage ? <Spinner /> : null} Load older
              mail
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
  return (
    <div className="min-h-0">
      {readingPane ? (
        <div className="grid h-dvh grid-cols-[22.5rem_minmax(0,1fr)] 2xl:grid-cols-[25rem_minmax(0,1fr)]">
          {/* scroll-exception: the approved desktop mail list scrolls independently of the adjacent reader. */}
          <div
            ref={listScroll}
            className="min-h-0 min-w-0 overflow-y-auto border-r border-border"
            aria-label="Conversation list"
          >
            {mailList}
          </div>
          {/* scroll-exception: the approved desktop reading pane keeps a long conversation beside the mail list. */}
          <section
            className="min-h-0 min-w-0 overflow-y-auto"
            aria-label="Reading pane"
          >
            {reader}
          </section>
        </div>
      ) : selectedThread ? (
        reader
      ) : (
        mailList
      )}

      {replyTarget && organizationId ? (
        <ReplyComposer
          key={`${replyTarget.id}:${searchParams.get("replyDraft") ?? ""}`}
          message={replyTarget}
          organizationId={organizationId}
          mailboxEmail={
            accounts.find(
              (account) => account.id === replyTarget.inboxAccountId
            )?.email ?? "Receiving mailbox"
          }
          initialDraftId={searchParams.get("replyDraft") ?? undefined}
          onClose={() => {
            setReplyTarget(null);
            setSearchParams(
              (current) => {
                const next = new URLSearchParams(current);
                next.delete("replyDraft");
                next.delete("move");
                return next;
              },
              { replace: true }
            );
          }}
          onQueued={() => {
            setReplyTarget(null);
            setSearchParams(
              (current) => {
                const next = new URLSearchParams(current);
                next.delete("replyDraft");
                next.delete("move");
                next.delete("message");
                return next;
              },
              { replace: true }
            );
            void conversationQuery.refetch();
            void queryClient.invalidateQueries({
              queryKey: ["outbox", organizationId],
            });
          }}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(disconnectTarget)}
        onOpenChange={(open) => {
          if (!open) setDisconnectTarget(null);
        }}
        title="Disconnect this mailbox?"
        description="New mail will stop syncing. Messages already received in QQueue will be kept, and the mailbox on your mail server is unchanged."
        confirmLabel="Disconnect mailbox"
        loading={removeAccount.isPending}
        onConfirm={() => {
          if (disconnectTarget)
            removeAccount.mutate(disconnectTarget, {
              onSuccess: () => setDisconnectTarget(null),
            });
        }}
      />
      {canManageMailboxes ? (
        <ConnectInboxDialog
          open={connectOpen}
          onOpenChange={setConnectOpen}
          organizationId={organizationId ?? ""}
        />
      ) : null}

      <AttachmentPreviewDialog
        preview={preview}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}
