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
import {
  isFullHtmlDocument,
  richTextCanRepresent,
  unsupportedInRichText
} from "./html-source";

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
 * ProseMirror schema, so anything it has no node for (<style>, <head>, the
 * <div> scaffolding of an exported email) is deleted or rewritten on the way in.
 * Pasted HTML therefore has to bypass it entirely rather than render into it.
 *
 * Which mode a body *opens* in is decided by the body itself, not by a fixed
 * default. Content the schema can't hold opens in HTML mode, because mounting
 * the rich text editor over it destroys it on sight — a template written as raw
 * HTML came back rewritten, which is indistinguishable from the save not having
 * worked. A complete HTML document goes further and locks HTML mode on: there is
 * no lossless way back, and it is sent verbatim, skipping the MJML wrapper.
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
  const [mode, setMode] = useState<BodyEditorMode>(() =>
    richTextCanRepresent(value) ? "rich" : "html"
  );
  const [pendingRichSwitch, setPendingRichSwitch] = useState<string[] | null>(
    null
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fullDocument = isFullHtmlDocument(value);
  const richSafe = richTextCanRepresent(value);

  // The one body the rich text editor is allowed to rewrite: whatever was on
  // screen when the user accepted the warning below. Without it, confirming
  // "switch anyway" would be undone by the effect on the very next render.
  const acceptedRewrite = useRef<string | null>(null);

  // Content the schema can't hold is pulled into HTML mode rather than fed to
  // the editor. The initial state above covers a body that is already present at
  // mount; this covers one that arrives later — a draft loading, or a template
  // being applied over what the user had — which is the case that silently ate
  // saved HTML before.
  useEffect(() => {
    if (richSafe) return;
    if (!fullDocument && value === acceptedRewrite.current) return;
    setMode("html");
  }, [richSafe, fullDocument, value]);

  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

  function switchToRich() {
    const { tags, attributes } = unsupportedInRichText(value);
    const casualties = [
      ...tags.map((tag) => `<${tag}>`),
      ...attributes.map((attribute) => `${attribute}=`)
    ];
    if (casualties.length > 0) {
      setPendingRichSwitch(casualties);
      return;
    }
    acceptedRewrite.current = value;
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
              Switching drops or rewrites {(pendingRichSwitch ?? []).join(", ")}{" "}
              along with the styling they carry, and there is no way back. Stay
              in HTML to keep it exactly as written.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay in HTML</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setPendingRichSwitch(null);
                acceptedRewrite.current = value;
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
