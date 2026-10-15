import { useState } from "react";
import {
  listPendingDrafts,
  type PendingDraft,
} from "../../lib/offline-drafts.js";
import { qk } from "../../lib/query-client.js";
import { useOrgQuery } from "../../lib/use-api.js";
import { Button } from "../ui/button.js";
import { DataGrid } from "../ui/data-grid.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { EmailPreviewFrame } from "../EmailPreviewFrame.js";

export function DeviceDraftCopies({
  organizationId,
  userId,
  onUse,
}: {
  organizationId: string;
  userId: string;
  onUse: (copy: PendingDraft) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<PendingDraft>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const copies = useOrgQuery(
    organizationId,
    qk.deviceDrafts(organizationId, userId),
    async (org) =>
      (await listPendingDrafts(org, true))
        .filter((copy) => !copy.payload.inboundMessageId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    { enabled: open, staleTime: 0, networkMode: "always" }
  );
  function label(copy: PendingDraft) {
    return `${copy.payload.subject || "Untitled message"} · ${new Date(copy.updatedAt).toLocaleString()}`;
  }
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setSelected(undefined);
          setError("");
          setOpen(true);
        }}
      >
        Review device drafts
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!loading) setOpen(value);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Draft copies on this device</DialogTitle>
            <DialogDescription>
              Unsent writing and retryable files from this account stay here
              until they reach the server. Review a copy before using it; your
              current writing is kept first.
            </DialogDescription>
          </DialogHeader>
          <Button
            type="button"
            variant="ghost"
            onClick={() => void copies.refetch()}
          >
            Refresh device drafts
          </Button>
          {copies.isError ? (
            <p role="alert">
              Couldn't read device drafts. Refresh to try again; keep your
              current writing open.
            </p>
          ) : null}
          <DataGrid
            className="[&_table]:table-fixed"
            label="Device drafts"
            data={copies.data ?? []}
            loading={copies.isPending}
            getRowId={(copy) => copy.localId}
            columns={[
              {
                id: "draft",
                header: "Device copy",
                enableHiding: false,
                enableSorting: false,
                cell: ({ row }) => (
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full min-w-0 justify-start"
                    onClick={() => setSelected(row.original)}
                  >
                    <span className="truncate">{label(row.original)}</span>
                  </Button>
                ),
              },
            ]}
            renderMobileRow={(copy) => <span>{label(copy)}</span>}
            onRowClick={setSelected}
            getRowLabel={(copy) => `Review ${label(copy)}`}
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
                title="Device draft copy"
              />
              {selected.attachments?.map((file) => (
                <p className="text-ui" key={file.id}>
                  {file.filename}
                </p>
              ))}
              {selected.pendingUploads?.map((file) => (
                <p className="text-ui" key={file.uploadId}>
                  {file.file.name} · waiting to upload
                </p>
              ))}
              <Button
                type="button"
                disabled={loading}
                onClick={async () => {
                  setLoading(true);
                  setError("");
                  try {
                    await onUse(selected);
                    setOpen(false);
                  } catch {
                    setError(
                      "Couldn't preserve your current writing. Keep this composer open and try again."
                    );
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                Use this device draft
              </Button>
            </div>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
