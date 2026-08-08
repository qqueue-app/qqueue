import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";

interface RawBlockDialogProps {
  open: boolean;
  /** Markup to start from — empty when inserting a new block. */
  initial: string;
  /** Editing an existing block rather than inserting one. */
  editing: boolean;
  onClose: () => void;
  onSubmit: (html: string) => void;
}

/**
 * Source editing for one region of the email, without leaving the editor.
 *
 * The point of a raw block is that its markup is kept exactly as written, so
 * this is the only way to change it — there is nothing for the toolbar to act
 * on. Editing here is scoped to the block, which is the difference from the
 * whole-document source view: the rest of the email stays rich text around it.
 */
export function RawBlockDialog({
  open,
  initial,
  editing,
  onClose,
  onSubmit
}: RawBlockDialogProps) {
  const [html, setHtml] = useState(initial);

  useEffect(() => {
    if (open) setHtml(initial);
  }, [open, initial]);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit HTML block" : "Insert HTML"}</DialogTitle>
          <DialogDescription>
            Kept exactly as written and sent as-is. Use this for markup the
            toolbar has no button for — a style block, a layout table, anything
            pasted in from elsewhere.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            // Radix portals this dialog out of the DOM but not out of the React
            // tree, so React keeps bubbling the submit into whatever page form
            // the editor sits in — which in Email Studio would send the message.
            event.stopPropagation();
            const trimmed = html.trim();
            if (!trimmed) {
              onClose();
              return;
            }
            onSubmit(trimmed);
          }}
        >
          <textarea
            value={html}
            onChange={(event) => setHtml(event.target.value)}
            spellCheck={false}
            autoFocus
            aria-label="Block HTML"
            placeholder="<table>…</table>"
            className="min-h-pane-sm w-full rounded-control border bg-background px-3 py-2 font-mono text-meta leading-relaxed text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">{editing ? "Save block" : "Insert"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
