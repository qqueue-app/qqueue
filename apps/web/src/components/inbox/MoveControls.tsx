import { useEffect, useRef, useState } from "react";
import { Archive, FolderInput, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  api,
  type InboundMessage,
  type InboxMoveInput,
  type MailboxView,
} from "../../lib/api.js";
import { qk } from "../../lib/query-client.js";
import { useApiMutation, useOrgQuery } from "../../lib/use-api.js";
import { Button } from "../ui/button.js";
import { IconButton } from "../ui/icon-button.js";
import { Label } from "../ui/label.js";
import { Spinner } from "../ui/spinner.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";

type Props = {
  messages: InboundMessage[];
  anchorId: string;
  organizationId: string;
  view: MailboxView;
  folderId?: string;
};

/** Folder actions are durable requests; the reader stays until IMAP confirms. */
export function MoveControls({
  messages,
  anchorId,
  organizationId,
  view,
  folderId,
}: Props) {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [chosenSource, setChosenSource] = useState<string>();
  const [targetId, setTargetId] = useState("");
  function changeDialog(next: boolean) {
    if (!next && create.isPending) return;
    setOpen(next);
    if (!next) {
      setChosenSource(undefined);
      setTargetId("");
    }
  }
  const intent = useRef<{ key: string; id: string }>();
  const accountId = messages[0]?.inboxAccountId;
  const locations = messages.flatMap((message) =>
    (message.locations ?? []).map((location) => ({
      ...location,
      messageId: message.id,
    }))
  );
  const anchorLocations = locations.filter(
    (location) => location.messageId === anchorId
  );
  const source =
    locations.find(
      (location) =>
        location.inboxFolderId ===
        ((open ? chosenSource : undefined) ?? folderId)
    ) ??
    (view === "INBOX"
      ? anchorLocations.find(
          (location) =>
            location.folder.isPrimary || location.folder.role === "INBOX"
        )
      : undefined) ??
    (view !== "ALL" && view !== "FLAGGED"
      ? locations.find((location) => location.folder.role === view)
      : undefined) ??
    locations.find((location) => location.folder.role === "INBOX") ??
    anchorLocations[0] ??
    locations[0];
  const sourceFolders = [
    ...new Map(
      locations.map((location) => [location.inboxFolderId, location])
    ).values(),
  ];
  const folders = useOrgQuery(
    organizationId,
    qk.inboxFolders(organizationId, accountId),
    (id) => api.listInboxFolders(id, accountId),
    { enabled: Boolean(accountId) }
  );
  const recent = useOrgQuery(
    organizationId,
    qk.inboxMoves(organizationId, anchorId),
    (id) => api.recentInboxMoves(anchorId, id),
    { refetchInterval: 10_000 }
  );
  const batchId = params.get("move") ?? recent.data?.[0]?.id;
  const batchQuery = useOrgQuery(
    organizationId,
    qk.inboxMoveBatch(organizationId, batchId ?? ""),
    (id) => api.getInboxMoveBatch(batchId!, id),
    {
      enabled: Boolean(batchId),
      refetchInterval: (query) => {
        const counts = query.state.data?.counts;
        return counts &&
          counts.PENDING + counts.PROCESSING + counts.UNCERTAIN === 0
          ? false
          : 2000;
      },
    }
  );
  const batch = batchQuery.data ?? recent.data?.[0];
  useEffect(() => {
    if (batch?.clientId && batch.clientId === intent.current?.id)
      intent.current = undefined;
  }, [batch?.clientId]);
  const counts = batch?.counts;
  const active = Boolean(
    counts && counts.PENDING + counts.PROCESSING + counts.UNCERTAIN > 0
  );
  const invalidateMail = () => {
    void client.invalidateQueries({
      queryKey: ["inbound-messages", organizationId],
    });
    void client.invalidateQueries({
      queryKey: ["inbox-conversation", organizationId],
    });
    void client.invalidateQueries({
      queryKey: qk.inboxUnreadCount(organizationId),
    });
  };
  const create = useApiMutation(
    async (input: {
      action: InboxMoveInput["action"];
      targetFolderId?: string;
    }) => {
      if (!source)
        throw new Error(
          "Check for new mail to confirm this message's current folder."
        );
      const key = JSON.stringify({
        ...input,
        source: source.id,
        messageId: source.messageId,
      });
      if (intent.current?.key !== key)
        intent.current = { key, id: crypto.randomUUID() };
      return api.createInboxMove(source.messageId, organizationId, {
        clientId: intent.current.id,
        sourceLocationId: source.id,
        scope: "CONVERSATION",
        ...input,
      });
    },
    {
      errorMessage:
        "Couldn't queue this folder action. Your cached message is kept.",
      onSuccess: (result) => {
        intent.current = undefined;
        client.setQueryData(
          qk.inboxMoveBatch(organizationId, result.id),
          result
        );
        setParams((current) => {
          const next = new URLSearchParams(current);
          next.set("move", result.id);
          return next;
        });
        setOpen(false);
        setChosenSource(undefined);
        setTargetId("");
        invalidateMail();
        void client.invalidateQueries({
          queryKey: qk.inboxMoves(organizationId, anchorId),
        });
      },
    }
  );
  const check = useApiMutation(
    () => api.checkInboxMoves(anchorId, organizationId),
    {
      onSuccess: () => {
        void recent.refetch();
        void batchQuery.refetch();
        invalidateMail();
      },
    }
  );
  const disabled = create.isPending || active || !source;
  const troubled = Boolean(counts && counts.FAILED + counts.UNCERTAIN > 0);
  const complete = Boolean(batch && counts && counts.DONE === batch.total);
  // A newly confirmed destination can change where the open conversation lives.
  // Invalidate its location metadata once per confirmed batch response.
  const acknowledged = useRef<string>();
  useEffect(() => {
    if (complete && acknowledged.current !== batch?.id) {
      acknowledged.current = batch?.id;
      invalidateMail();
    }
  }, [complete, batch?.id]);
  if (!source && !batch && !batchQuery.isError && !recent.isError) return null;
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        <IconButton
          label="Archive conversation"
          disabled={disabled || source?.folder.role === "ARCHIVE"}
          onClick={() => create.mutate({ action: "ARCHIVE" })}
        >
          <Archive />
        </IconButton>
        {source?.folder.role === "TRASH" ? (
          <IconButton
            label="Restore conversation"
            disabled={disabled}
            onClick={() => create.mutate({ action: "RESTORE" })}
          >
            <Undo2 />
          </IconButton>
        ) : (
          <IconButton
            label="Move conversation to Trash"
            disabled={disabled}
            onClick={() => create.mutate({ action: "TRASH" })}
          >
            <Trash2 />
          </IconButton>
        )}
        <IconButton
          label="Move conversation to a folder"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <FolderInput />
        </IconButton>
        {create.isPending ? (
          <span role="status" className="text-meta text-text-secondary">
            <Spinner /> Accepting folder action…
          </span>
        ) : null}
      </div>
      {create.isError ? (
        <p role="alert" className="text-meta text-err">
          {create.error instanceof Error
            ? create.error.message
            : "The folder action was not confirmed. Check status before trying again."}
        </p>
      ) : null}
      {batch ? (
        <div
          role={troubled ? "alert" : "status"}
          className="rounded-control border border-border bg-surface-sunken p-3 text-meta text-text-secondary"
        >
          <p>
            {complete
              ? `Moved to ${batch.moves[0]?.targetPath ?? "the destination folder"}.`
              : `${counts?.DONE ?? 0} of ${batch.total} messages moved${active ? "; checking the mailbox…" : "."}`}
          </p>
          {[
            ...new Set(
              batch.moves.flatMap((move) => (move.error ? [move.error] : []))
            ),
          ]
            .slice(0, 2)
            .map((error) => (
              <p key={error} className="mt-1">
                {error}
              </p>
            ))}
          {counts?.FAILED ? (
            <p className="mt-1">
              {counts.FAILED} message
              {counts.FAILED === 1 ? " could" : "s could"} not be moved. Their
              cached writing is kept.
            </p>
          ) : null}
          {active || troubled ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={check.isPending}
              onClick={() => check.mutate()}
            >
              <RefreshCw /> Check status
            </Button>
          ) : null}
        </div>
      ) : null}
      {batchQuery.isError || recent.isError ? (
        <p role="alert" className="text-meta text-err">
          Couldn't load folder-action status.{" "}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void recent.refetch();
              if (batchId) void batchQuery.refetch();
            }}
          >
            Try again
          </Button>
        </p>
      ) : null}
      <Dialog open={open} onOpenChange={changeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move conversation</DialogTitle>
            <DialogDescription>
              Moves the conversation's messages from the chosen folder. Cached
              messages remain readable while the mail server confirms.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>From folder</Label>
              <Select
                value={source?.inboxFolderId ?? ""}
                onValueChange={setChosenSource}
                disabled={create.isPending}
              >
                <SelectTrigger aria-label="Move from folder">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sourceFolders.map((location) => (
                    <SelectItem
                      key={location.inboxFolderId}
                      value={location.inboxFolderId}
                    >
                      {location.folder.path}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>To folder</Label>
              <Select
                value={targetId}
                onValueChange={setTargetId}
                disabled={create.isPending}
              >
                <SelectTrigger aria-label="Move to folder">
                  <SelectValue placeholder="Choose a destination" />
                </SelectTrigger>
                <SelectContent>
                  {(folders.data ?? [])
                    .filter(
                      (folder) =>
                        folder.present && folder.id !== source?.inboxFolderId
                    )
                    .map((folder) => (
                      <SelectItem key={folder.id} value={folder.id}>
                        {folder.path}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            {folders.isError ? (
              <p role="alert">
                Couldn't load destination folders.{" "}
                <Button variant="ghost" onClick={() => void folders.refetch()}>
                  Try again
                </Button>
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              disabled={create.isPending}
              onClick={() => changeDialog(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={
                disabled ||
                folders.isPending ||
                folders.isError ||
                !targetId ||
                targetId === source?.inboxFolderId
              }
              onClick={() =>
                create.mutate({ action: "MOVE", targetFolderId: targetId })
              }
            >
              Move conversation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
