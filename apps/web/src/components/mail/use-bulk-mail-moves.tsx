import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Trash2 } from "lucide-react";
import {
  api,
  type InboundMessage,
  type InboxMoveBatchSummary,
  type MailboxView,
} from "../../lib/api.js";
import { qk } from "../../lib/query-client.js";
import { useApiMutation, useOrgQuery } from "../../lib/use-api.js";
import { IconButton } from "../ui/icon-button.js";
import { Button } from "../ui/button.js";

type Thread = {
  messages: InboundMessage[];
  latestMessage: InboundMessage;
  subject: string;
};
type Accepted = { subject: string; batch: InboxMoveBatchSummary };
/** Fan out existing authorized, durable conversation moves; retain retry identities. */
export function useBulkMailMoves(
  organizationId: string | undefined,
  view: MailboxView,
  folderId?: string
) {
  const identities = useRef(
    new Map<string, { clientId: string; accepted?: Accepted }>()
  );
  const [accepted, setAccepted] = useState<Accepted[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const move = useApiMutation(
    async ({
      threads,
      action,
      clear,
    }: {
      threads: Thread[];
      action: "ARCHIVE" | "TRASH";
      clear: () => void;
    }) => {
      const queued: Accepted[] = [],
        errors: string[] = [];
      for (const thread of threads) {
        const candidates = [
          thread.latestMessage,
          ...thread.messages.filter(
            (message) => message.id !== thread.latestMessage.id
          ),
        ];
        const locations = candidates.flatMap((message) =>
          (message.locations ?? []).map((location) => ({ message, location }))
        );
        const source =
          locations.find((item) =>
            folderId
              ? item.location.inboxFolderId === folderId
              : item.location.folder.role === view
          ) ?? locations[0];
        if (!organizationId || !source) {
          errors.push(
            `${thread.subject}: refresh this folder to confirm its current location.`
          );
          continue;
        }
        const identity = `${organizationId}:${source.location.id}:${action}`;
        const record = identities.current.get(identity) ?? {
          clientId: crypto.randomUUID(),
        };
        identities.current.set(identity, record);
        if (record.accepted) {
          queued.push(record.accepted);
          continue;
        }
        try {
          const batch = await api.createInboxMove(
            source.message.id,
            organizationId,
            {
              clientId: record.clientId,
              sourceLocationId: source.location.id,
              action,
              scope: "CONVERSATION",
            }
          );
          record.accepted = { subject: thread.subject, batch };
          queued.push(record.accepted);
        } catch (error) {
          errors.push(
            `${thread.subject}: ${error instanceof Error ? error.message : "request not confirmed; retry safely"}`
          );
        }
      }
      setAccepted(queued);
      setFailures(errors);
      if (!errors.length) clear();
    },
    {
      errorMessage:
        "Couldn't request these folder changes. Your selection is kept.",
    }
  );
  return {
    controls: (threads: Thread[], clear: () => void) => (
      <>
        <IconButton
          label="Archive selected"
          disabled={move.isPending}
          onClick={() => move.mutate({ threads, action: "ARCHIVE", clear })}
        >
          <Archive />
        </IconButton>
        <IconButton
          label="Move selected to trash"
          disabled={move.isPending}
          onClick={() => move.mutate({ threads, action: "TRASH", clear })}
        >
          <Trash2 />
        </IconButton>
        {move.isPending ? (
          <span role="status" className="text-meta">
            Requesting folder changes…
          </span>
        ) : null}
      </>
    ),
    progress: (
      <>
        {failures.length ? (
          <div
            role="alert"
            className="border-b border-border bg-warn-bg px-4 py-3 text-meta"
          >
            <p>
              Some folder requests were not confirmed. Your selection is kept;
              retrying reuses the same requests.
            </p>
            {failures.map((error, index) => (
              <p key={index}>{error}</p>
            ))}
          </div>
        ) : null}
        {accepted.length && organizationId ? (
          <details className="border-b border-border px-4 py-2 text-meta" open>
            <summary className="cursor-pointer">
              Folder action progress ({accepted.length} conversations)
            </summary>
            <div className="space-y-2 py-2">
              {accepted.map((item) => (
                <MoveProgress
                  key={item.batch.id}
                  organizationId={organizationId}
                  item={item}
                />
              ))}
            </div>
          </details>
        ) : null}
      </>
    ),
  };
}
function MoveProgress({
  organizationId,
  item,
}: {
  organizationId: string;
  item: Accepted;
}) {
  const client = useQueryClient();
  const query = useOrgQuery(
    organizationId,
    qk.inboxMoveBatch(organizationId, item.batch.id),
    (org) => api.getInboxMoveBatch(item.batch.id, org),
    {
      initialData: item.batch,
      refetchInterval: (state) => {
        const counts = state.state.data?.counts;
        return counts &&
          counts.PENDING + counts.PROCESSING + counts.UNCERTAIN === 0
          ? false
          : 2000;
      },
    }
  );
  const batch = query.data ?? item.batch;
  const counts = batch.counts;
  const active = counts.PENDING + counts.PROCESSING + counts.UNCERTAIN > 0;
  const check = useApiMutation(
    () => api.checkInboxMoves(batch.id, organizationId),
    {
      onSuccess: () => {
        void query.refetch();
      },
    }
  );
  useEffect(() => {
    if (active) return;
    void client.invalidateQueries({
      queryKey: ["inbound-messages", organizationId],
    });
    void client.invalidateQueries({
      queryKey: ["mail-search", organizationId],
    });
    void client.invalidateQueries({
      queryKey: qk.inboxUnreadCount(organizationId),
    });
  }, [active, client, organizationId]);
  return (
    <div
      role={
        counts.FAILED || counts.UNCERTAIN || query.isError ? "alert" : "status"
      }
      className="flex flex-wrap items-center gap-2"
    >
      <span className="min-w-0 break-words">
        {item.subject}: {counts.DONE} of {batch.total} messages moved
        {active
          ? "; waiting for mailbox confirmation"
          : counts.FAILED
            ? "; some messages could not be moved"
            : ""}
        .{query.isError ? " Status could not be refreshed." : ""}
      </span>
      {active || counts.FAILED || query.isError ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={check.isPending}
          onClick={() => check.mutate()}
        >
          Check status
        </Button>
      ) : null}
    </div>
  );
}
