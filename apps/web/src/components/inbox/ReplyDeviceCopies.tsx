import { useState } from "react";
import {
  listReplyBackups,
  type StoredReplyBackup,
} from "../../lib/reply-backup.js";
import { DataGrid } from "../ui/data-grid.js";
import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { EmailPreviewFrame } from "../EmailPreviewFrame.js";

export function ReplyDeviceCopies({
  userId,
  organizationId,
  messageId,
  draftId,
  currentKey,
  onUse,
}: {
  userId: string;
  organizationId: string;
  messageId: string;
  draftId?: string;
  currentKey: string;
  onUse: (copy: StoredReplyBackup) => Promise<void>;
}) {
  const [copies, setCopies] = useState<StoredReplyBackup[] | null>(null);
  const [selected, setSelected] = useState<StoredReplyBackup>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  function open() {
    const distinct = new Map<string, StoredReplyBackup>();
    for (const copy of listReplyBackups(
      userId,
      organizationId,
      messageId,
      draftId
    )) {
      if (copy.key === currentKey) continue;
      const { value } = copy;
      const fingerprint = JSON.stringify([
        value.html,
        value.to,
        value.cc,
        value.bcc,
        value.recipientInputs,
        value.attachments,
        value.signature,
      ]);
      if (!distinct.has(fingerprint)) distinct.set(fingerprint, copy);
    }
    setCopies([...distinct.values()]);
    setSelected(undefined);
    setError("");
  }
  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={open}>
        Review device copies
      </Button>
      <Dialog
        open={copies !== null}
        onOpenChange={(open) => {
          if (!open && !loading) setCopies(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Reply copies on this device</DialogTitle>
            <DialogDescription>
              Copies from other tabs and earlier openings stay separate. Review
              a copy before replacing your current writing. Your current copy
              will be kept too.
            </DialogDescription>
          </DialogHeader>
          {!copies?.length ? (
            <p className="text-ui">No other device copies for this reply.</p>
          ) : (
            <DataGrid
              label="Device reply copies"
              data={copies}
              getRowId={(copy) => copy.key}
              className="[&_table]:table-fixed"
              columns={[
                {
                  id: "copy",
                  header: "Device copy",
                  enableHiding: false,
                  enableSorting: false,
                  cell: ({ row }) => (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setSelected(row.original)}
                    >
                      Review copy {row.index + 1}
                      {row.original.value.updatedAt
                        ? ` · ${new Date(row.original.value.updatedAt).toLocaleString()}`
                        : ""}
                    </Button>
                  ),
                },
              ]}
              renderMobileRow={(copy) => (
                <span>
                  Device reply copy
                  {copy.value.updatedAt
                    ? ` · ${new Date(copy.value.updatedAt).toLocaleString()}`
                    : ""}
                </span>
              )}
              onRowClick={setSelected}
              getRowLabel={(copy) => `Review copy ${copies.indexOf(copy) + 1}`}
              searchable={false}
              paginated={false}
            />
          )}
          {selected ? (
            <div className="space-y-3">
              <p className="text-ui">
                This is a device backup, not a new server save.
              </p>
              <EmailPreviewFrame
                html={selected.value.html}
                title="Device reply copy"
              />
              <p className="break-words text-ui">
                To:{" "}
                {Array.isArray(selected.value.to)
                  ? selected.value.to.join(", ")
                  : "No recipients"}
              </p>
              {Array.isArray(selected.value.cc) && selected.value.cc.length ? (
                <p className="text-ui">Cc: {selected.value.cc.join(", ")}</p>
              ) : null}
              {Array.isArray(selected.value.bcc) &&
              selected.value.bcc.length ? (
                <p className="text-ui">Bcc: {selected.value.bcc.join(", ")}</p>
              ) : null}
              {Array.isArray(selected.value.attachments)
                ? selected.value.attachments.map(
                    (file: { id: string; filename: string }) => (
                      <p key={file.id} className="text-ui">
                        {file.filename}
                      </p>
                    )
                  )
                : null}
              {Array.isArray(selected.value.pendingFiles)
                ? selected.value.pendingFiles.map(
                    (file: { name: string }, index: number) => (
                      <p key={index} className="text-ui">
                        {file.name} · waiting to upload
                      </p>
                    )
                  )
                : null}
              <Button
                type="button"
                disabled={loading}
                onClick={async () => {
                  setLoading(true);
                  setError("");
                  try {
                    await onUse(selected);
                    setCopies(null);
                  } catch (error) {
                    setError(
                      error instanceof Error
                        ? error.message
                        : "Couldn't preserve your current copy. Keep this reply open and try again."
                    );
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                Use this device copy
              </Button>
            </div>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
