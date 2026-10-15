import { useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import {
  listWindowDrafts,
  subscribeWindowDrafts,
  windowDraftCount,
  retryWindowDrafts,
} from "../lib/window-drafts.js";
import { savePendingDraft, type PendingDraft } from "../lib/offline-drafts.js";
import { useSession } from "../lib/session-context.js";
import { useApiMutation, useOrgQuery } from "../lib/use-api.js";
import { qk } from "../lib/query-client.js";
import { Button } from "./ui/button.js";
import { DataGrid } from "./ui/data-grid.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.js";
import { EmailPreviewFrame } from "./EmailPreviewFrame.js";
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function WindowDraftNotice() {
  const { user, organizations, setCurrentOrganizationId } = useSession();
  const owner = user?.id ?? "";
  const count = useSyncExternalStore(subscribeWindowDrafts, () =>
    windowDraftCount(owner)
  );
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<PendingDraft>();
  const navigate = useNavigate();
  const copies = useOrgQuery(
    "window",
    qk.windowDrafts(owner),
    async () => listWindowDrafts(owner),
    {
      enabled: open && Boolean(owner),
      networkMode: "always",
      staleTime: 0,
      refetchInterval: 2000,
    }
  );
  const retrySaving = useApiMutation(
    async () => {
      await retryWindowDrafts(owner, savePendingDraft);
      if (windowDraftCount(owner))
        throw new Error(
          "Browser storage is still unavailable. Keep this window open or download your writing and files."
        );
    },
    {
      networkMode: "always",
      successMessage: "Window copies kept on this device.",
    }
  );
  if (!count) return null;
  const organizationName = (id: string) =>
    organizations.find((org) => org.id === id)?.name ?? "Earlier organization";
  return (
    <>
      <div
        role="status"
        className="flex flex-wrap items-center justify-center gap-2 border-b border-warn/20 bg-warn-bg px-4 py-field text-ui text-warn"
      >
        <span>
          Some writing is kept only in this window. Keep it open until saving
          succeeds.
        </span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            setSelected(undefined);
            setOpen(true);
          }}
        >
          Review window copies
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Writing kept in this window</DialogTitle>
            <DialogDescription>
              Browser storage is unavailable. These copies survive navigation
              inside QQueue, but closing this window can lose them. Download
              your writing and any waiting files if you need to close it.
            </DialogDescription>
          </DialogHeader>
          <Button
            type="button"
            variant="secondary"
            disabled={retrySaving.isPending}
            onClick={() => retrySaving.mutate()}
          >
            Retry device saving
          </Button>
          <DataGrid
            label="Window writing copies"
            data={copies.data ?? []}
            loading={copies.isPending}
            className="[&_table]:table-fixed"
            columns={[
              {
                id: "copy",
                header: "Window copy",
                enableSorting: false,
                enableHiding: false,
                cell: ({ row }) => (
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full min-w-0 justify-start"
                    onClick={() => setSelected(row.original)}
                  >
                    <span className="truncate">
                      {row.original.payload.subject || "Untitled message"} ·{" "}
                      {organizationName(row.original.organizationId)}
                    </span>
                  </Button>
                ),
              },
            ]}
            getRowId={(copy) => copy.localId}
            onRowClick={setSelected}
            getRowLabel={(copy) =>
              `Review ${copy.payload.subject || "untitled message"}`
            }
            renderMobileRow={(copy) => (
              <p>
                {copy.payload.subject || "Untitled message"} ·{" "}
                {organizationName(copy.organizationId)}
              </p>
            )}
            searchable={false}
            paginated={false}
          />
          {selected ? (
            <div className="space-y-3">
              <p className="break-words text-ui">
                To: {selected.payload.to.join(", ") || "No recipients"}
              </p>
              {selected.payload.cc.length ? (
                <p className="text-ui">Cc: {selected.payload.cc.join(", ")}</p>
              ) : null}
              {selected.payload.bcc.length ? (
                <p className="text-ui">
                  Bcc: {selected.payload.bcc.join(", ")}
                </p>
              ) : null}
              <EmailPreviewFrame
                html={selected.payload.html}
                title="Window writing copy"
              />
              {selected.attachments?.map((file) => (
                <p className="text-ui" key={file.id}>
                  {file.filename} · previously uploaded
                </p>
              ))}
              {selected.pendingUploads?.map((file) => (
                <Button
                  type="button"
                  variant="secondary"
                  key={file.uploadId}
                  onClick={() => download(file.file, file.file.name)}
                >
                  Download waiting file: {file.file.name}
                </Button>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    download(
                      new Blob(
                        [
                          `Subject: ${selected.payload.subject}\nTo: ${selected.payload.to.join(", ")}\nCc: ${selected.payload.cc.join(", ")}\nBcc: ${selected.payload.bcc.join(", ")}\n\n${selected.payload.html}`,
                        ],
                        { type: "text/plain;charset=utf-8" }
                      ),
                      "qqueue-unsaved-writing.txt"
                    )
                  }
                >
                  Download writing
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setCurrentOrganizationId(selected.organizationId);
                    const params = new URLSearchParams();
                    if (selected.payload.inboundMessageId) {
                      params.set("message", selected.payload.inboundMessageId);
                      params.set("replyBackup", selected.localId);
                      if (selected.draftId)
                        params.set("replyDraft", selected.draftId);
                      navigate(`/inbox?${params}`);
                    } else {
                      params.set("restore", selected.localId);
                      navigate(`/email-studio?${params}`);
                    }
                    setOpen(false);
                  }}
                >
                  Open this writing
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
