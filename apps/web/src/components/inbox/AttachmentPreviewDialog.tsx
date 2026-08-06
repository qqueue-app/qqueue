import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import type { InboundAttachment } from "../../lib/api.js";
import { formatBytes } from "../../lib/format.js";
import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../ui/dialog.js";

/**
 * Types we are willing to render in-app. Deliberately an allow-list of formats
 * the browser renders *without* parsing them as markup:
 *
 * - raster images only. SVG is excluded on purpose — a blob: URL inherits this
 *   page's origin, so displaying a sender's SVG would be stored XSS on our own
 *   origin (the same reason image uploads reject it).
 * - PDF, which the browser hands to its built-in viewer.
 * - plain text, which we render as a text node rather than as a document.
 *
 * Anything else (documents, archives, HTML) falls back to downloading, which is
 * what the operating system is for.
 */
const IMAGE_TYPES = /^image\/(png|jpeg|jpg|gif|webp|avif|bmp|x-icon)$/i;
const TEXT_TYPES = /^text\/(plain|csv|markdown)$/i;

export type AttachmentPreviewKind = "image" | "pdf" | "text";

export function attachmentPreviewKind(
  contentType: string
): AttachmentPreviewKind | null {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (IMAGE_TYPES.test(type)) return "image";
  if (type === "application/pdf") return "pdf";
  if (TEXT_TYPES.test(type)) return "text";
  return null;
}

/** Save a fetched blob to disk under its original filename. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Cap in-dialog text rendering so a huge log file can't lock the tab up. */
const TEXT_PREVIEW_LIMIT = 500_000;

interface AttachmentPreviewDialogProps {
  /** The attachment on screen plus its already-fetched bytes; null = closed. */
  preview: { attachment: InboundAttachment; blob: Blob } | null;
  onClose(): void;
}

/**
 * Show a received attachment in place instead of pushing it to the downloads
 * folder — opening a file a colleague emailed should feel like opening it, not
 * like acquiring it.
 *
 * The bytes are already in hand: the download route is authenticated, so the
 * caller fetches with the session token and hands over a Blob. We re-wrap it
 * with the MIME type our own allow-list chose rather than the one the sender
 * declared, so the browser cannot be talked into treating a mislabelled part as
 * a document. Non-previewable types never reach this dialog.
 */
export function AttachmentPreviewDialog({
  preview,
  onClose
}: AttachmentPreviewDialogProps) {
  const kind = preview
    ? attachmentPreviewKind(preview.attachment.contentType)
    : null;

  // Re-typed copy of the blob: the URL below is same-origin, so the type it
  // renders under must be one we picked, never one the sender supplied.
  const typedBlob = useMemo(() => {
    if (!preview || !kind) return null;
    const type =
      kind === "pdf"
        ? "application/pdf"
        : kind === "text"
          ? "text/plain"
          : preview.attachment.contentType.split(";")[0]!.trim().toLowerCase();
    return new Blob([preview.blob], { type });
  }, [preview, kind]);

  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);

  // Text is rendered as a React text node, so it needs the decoded string
  // rather than a URL; everything else needs a URL, revoked on close so the
  // blob is not pinned in memory for the rest of the session.
  useEffect(() => {
    if (!typedBlob || kind === "text") {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(typedBlob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [typedBlob, kind]);

  useEffect(() => {
    if (!typedBlob || kind !== "text") {
      setText(null);
      return;
    }
    // FileReader rather than Blob.text(): same result, and it is the decoding
    // path available everywhere the app runs.
    let cancelled = false;
    const reader = new FileReader();
    reader.onload = () => {
      if (!cancelled) {
        setText(String(reader.result ?? "").slice(0, TEXT_PREVIEW_LIMIT));
      }
    };
    reader.onerror = () => {
      if (!cancelled) setText("");
    };
    reader.readAsText(typedBlob);
    return () => {
      cancelled = true;
      reader.abort();
    };
  }, [typedBlob, kind]);

  if (!preview || !kind) return null;
  const { attachment, blob } = preview;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate">{attachment.filename}</DialogTitle>
          <DialogDescription>
            {attachment.contentType} · {formatBytes(attachment.size)}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[240px] overflow-hidden rounded-lg border bg-muted/30">
          {kind === "image" && objectUrl ? (
            <img
              src={objectUrl}
              alt={attachment.filename}
              className="mx-auto max-h-[70vh] w-auto max-w-full object-contain"
            />
          ) : null}

          {/*
            The PDF viewer is a browser-internal renderer, not a document we
            script against, and the blob is typed application/pdf by us — so
            there is nothing here for a sandbox to contain, and Chrome's viewer
            refuses to render inside a script-less sandboxed frame anyway.
          */}
          {kind === "pdf" && objectUrl ? (
            <iframe
              src={objectUrl}
              title={attachment.filename}
              className="h-[70vh] w-full border-0 bg-background"
            />
          ) : null}

          {kind === "text" ? (
            <pre className="max-h-[70vh] overflow-auto p-4 text-xs leading-5 whitespace-pre-wrap break-words">
              {text ?? "Loading…"}
              {text && blob.size > TEXT_PREVIEW_LIMIT
                ? "\n\n… truncated. Download the file to read the rest."
                : null}
            </pre>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => downloadBlob(blob, attachment.filename)}
          >
            <Download className="mr-2 h-4 w-4" />
            Download
          </Button>
          <Button type="button" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
