import { useEffect, useRef, useState } from "react";
import { Code2, Pencil } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { RichTextEditor } from "./RichTextEditor";
import { isFullHtmlDocument, unsupportedInRichText } from "./html-source";

export type BodyEditorMode = "rich" | "html";

interface BodyEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  variables?: string[];
  showVariables?: boolean;
  onUploadImage?: (file: File) => Promise<string>;
  /** Notified whenever the active mode changes, for callers that adapt around it. */
  onModeChange?: (mode: BodyEditorMode) => void;
  className?: string;
}

/**
 * The email body authoring surface: a rich text editor and a raw HTML source
 * view over one HTML string.
 *
 * HTML mode writes straight to `value` and never mounts the rich text editor,
 * which matters more than it looks: the editor round-trips content through the
 * ProseMirror schema, so anything it has no node for (<style>, <head>, most
 * layout tables from an exported email) is silently deleted on the way in.
 * Pasted HTML therefore has to bypass it entirely rather than render into it.
 *
 * A complete HTML document locks the editor to HTML mode for the same reason —
 * there is no lossless way back — and is sent verbatim, skipping the server's
 * MJML wrapper.
 */
export function BodyEditor({
  value,
  onChange,
  placeholder,
  variables,
  showVariables,
  onUploadImage,
  onModeChange,
  className
}: BodyEditorProps) {
  const [mode, setMode] = useState<BodyEditorMode>("rich");
  const [pendingRichSwitch, setPendingRichSwitch] = useState<string[] | null>(
    null
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fullDocument = isFullHtmlDocument(value);

  // A pasted full document can't round-trip through the rich text editor, so
  // take the user there rather than letting the editor eat it. This also covers
  // loading a draft or template that was authored as raw HTML.
  useEffect(() => {
    if (fullDocument) {
      setMode("html");
    }
  }, [fullDocument]);

  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

  function switchToRich() {
    const casualties = unsupportedInRichText(value);
    if (casualties.length > 0) {
      setPendingRichSwitch(casualties);
      return;
    }
    setMode("rich");
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1 rounded-md border bg-muted/40 p-0.5">
          <button
            type="button"
            onClick={switchToRich}
            disabled={fullDocument}
            title={
              fullDocument
                ? "A full HTML document can't be edited as rich text without losing its <head>, styles, and layout"
                : "Rich text"
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5",
              mode === "rich" && "bg-background text-foreground shadow-sm"
            )}
          >
            <Pencil />
            Rich text
          </button>
          <button
            type="button"
            onClick={() => setMode("html")}
            title="Edit the raw HTML"
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-3.5",
              mode === "html" && "bg-background text-foreground shadow-sm"
            )}
          >
            <Code2 />
            HTML
          </button>
        </div>

        {fullDocument ? (
          <Badge variant="warning" title="No MJML wrapper is applied.">
            Full HTML document — sent as-is
          </Badge>
        ) : null}
      </div>

      {mode === "rich" ? (
        <RichTextEditor
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          variables={variables}
          showVariables={showVariables}
          onUploadImage={onUploadImage}
        />
      ) : (
        <div className="space-y-1.5">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            spellCheck={false}
            aria-label="HTML source"
            placeholder={
              placeholder ?? "Paste your HTML here — the preview updates as you type."
            }
            className="min-h-[280px] w-full rounded-md border bg-background px-3 py-2 font-mono text-xs leading-relaxed text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            {fullDocument
              ? "Sent exactly as written. Your document supplies its own styles, so nothing is wrapped around it."
              : "A fragment is wrapped in an email-safe layout on send. Paste a full document (with <html> or <body>) to send it untouched."}
          </p>
        </div>
      )}

      <AlertDialog
        open={pendingRichSwitch !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRichSwitch(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to rich text?</AlertDialogTitle>
            <AlertDialogDescription>
              The rich text editor can&apos;t represent everything in this HTML.
              Switching removes{" "}
              {(pendingRichSwitch ?? [])
                .map((tag) => `<${tag}>`)
                .join(", ")}{" "}
              and may rewrite the surrounding markup. Stay in HTML to keep it
              exactly as written.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay in HTML</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setPendingRichSwitch(null);
                setMode("rich");
              }}
            >
              Switch anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
