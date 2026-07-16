import { useEffect, useRef, useState } from "react";
import { ImagePlus, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";

/** Mirrors the server-side allowlist in apps/api/src/modules/images/service.ts. */
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

interface ImageDialogProps {
  open: boolean;
  onClose: () => void;
  onInsert: (url: string) => void;
  /**
   * Uploads a file and resolves to its public URL. Omitted when the host page
   * has no organization context, in which case only linking is offered.
   */
  onUpload?: (file: File) => Promise<string>;
}

export function ImageDialog({
  open,
  onClose,
  onInsert,
  onUpload
}: ImageDialogProps) {
  const [url, setUrl] = useState("https://");
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setUrl("https://");
      setUploading(false);
      setDragging(false);
      setError(null);
    }
  }, [open]);

  async function handleFile(file: File) {
    if (!onUpload) {
      return;
    }
    // Checked here as well as on the server so a wrong file gives an immediate
    // answer instead of a round-trip. The server remains the real gate.
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Images must be PNG, JPEG, GIF, or WebP.");
      return;
    }

    setError(null);
    setUploading(true);
    try {
      onInsert(await onUpload(file));
      onClose();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Unable to upload that image."
      );
      setUploading(false);
    }
  }

  function submitLink(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || trimmed === "https://") {
      return;
    }
    onInsert(trimmed);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Insert image</DialogTitle>
          <DialogDescription>
            {onUpload
              ? "Upload an image or link to one that's already online."
              : "Link to an image that's already online."}
          </DialogDescription>
        </DialogHeader>

        {onUpload ? (
          <>
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const file = event.dataTransfer.files?.[0];
                if (file) {
                  void handleFile(file);
                }
              }}
              className={cn(
                "flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center transition-colors",
                dragging ? "border-primary bg-primary/5" : "border-input"
              )}
            >
              {uploading ? (
                <>
                  <Spinner />
                  <p className="text-sm text-muted-foreground">Uploading…</p>
                </>
              ) : (
                <>
                  <ImagePlus className="h-6 w-6 text-muted-foreground" />
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      Drag an image here, or
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => fileInput.current?.click()}
                    >
                      <Upload className="h-4 w-4" />
                      Choose file
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    PNG, JPEG, GIF, or WebP
                  </p>
                </>
              )}
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPTED_TYPES.join(",")}
                className="hidden"
                aria-label="Upload image"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // Reset so picking the same file twice still fires onChange.
                  event.target.value = "";
                  if (file) {
                    void handleFile(file);
                  }
                }}
              />
            </div>

            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs uppercase text-muted-foreground">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        ) : null}

        <form onSubmit={submitLink} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="image-url">Image URL</Label>
            <Input
              id="image-url"
              type="url"
              placeholder="https://example.com/banner.png"
              value={url}
              disabled={uploading}
              onChange={(event) => setUrl(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Linked images must stay reachable — recipients load them when they
              open the email.
            </p>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={uploading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={uploading}>
              Insert image
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
