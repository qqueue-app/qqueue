import { useCallback, useEffect, useState } from "react";
import { Code2, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { RichTextEditor } from "./RichTextEditor";
import { countRawBlocks, fromEditorHtml, toEditorHtml } from "./document-model";
import { isFullHtmlDocument } from "./html-source";

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
 * view over one HTML string, either of which can hold any document.
 *
 * The two used to be exclusive. Loading arbitrary HTML into the rich text
 * editor destroys it — ProseMirror keeps a document as schema nodes, so markup
 * with no node is not damaged on the way in, it is never stored at all — and
 * the only defence available was to refuse: content the schema couldn't hold
 * opened in the source view and stayed there. That was right about the loss and
 * wrong about the cost. One `<style>` block meant no toolbar for the whole
 * email, permanently.
 *
 * The document is now split rather than refused (see document-model.ts): a
 * complete document's scaffold is set aside and restored, regions the schema
 * can't hold become raw blocks holding their markup verbatim, and everything
 * else is ordinary editable content. Switching is lossless in both directions,
 * so it is only a switch — no lock, no warning, nothing lost by trying it.
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
  const [prepared, setPrepared] = useState(() => toEditorHtml(value));

  // What this component last produced. Everything it emits arrives back as the
  // `value` prop on the next render, and re-deriving the editor document from
  // it would discard the editor's own state — selection, undo history — on
  // every keystroke.
  const [emitted, setEmitted] = useState<string | null>(null);

  // Splitting a document is a parse and serialize per pass, so it happens when
  // one *arrives* — at mount, when a draft loads, when a template is applied
  // over what the author had, and when returning from the source view — rather
  // than on every keystroke. In the source view it never happens at all: the
  // editor isn't mounted, so there is nothing to prepare it for.
  useEffect(() => {
    if (mode !== "rich" || value === emitted) return;
    setPrepared(toEditorHtml(value));
  }, [value, mode, emitted]);

  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

  const { shell } = prepared;
  const handleRichChange = useCallback(
    (html: string) => {
      setPrepared((current) => ({ ...current, html }));
      const next = fromEditorHtml(html, shell);
      setEmitted(next);
      onChange(next);
    },
    [onChange, shell]
  );

  const fullDocument = isFullHtmlDocument(value);
  // Counted from what the editor is holding rather than from the split, so it
  // still reads true after a block is added or deleted.
  const frozen = countRawBlocks(prepared.html);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1 rounded-control border bg-muted/40 p-1">
          <button
            type="button"
            onClick={() => setMode("rich")}
            title="Rich text"
            className={cn(
              // 24px tall was under half §5's touch minimum, on the control
              // that switches the whole authoring surface. Full height on a
              // phone; unchanged from the tablet breakpoint up.
              "inline-flex min-h-touch items-center gap-field rounded px-3 py-1 text-meta font-medium text-muted-foreground transition-colors hover:text-foreground sm:min-h-0 sm:px-2 [&_svg]:size-3.5",
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
              // 24px tall was under half §5's touch minimum, on the control
              // that switches the whole authoring surface. Full height on a
              // phone; unchanged from the tablet breakpoint up.
              "inline-flex min-h-touch items-center gap-field rounded px-3 py-1 text-meta font-medium text-muted-foreground transition-colors hover:text-foreground sm:min-h-0 sm:px-2 [&_svg]:size-3.5",
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

        {/* Says what rich text is doing with markup it has no formatting for,
            so the framed blocks in the editor aren't a surprise. */}
        {mode === "rich" && frozen > 0 ? (
          <span className="text-meta text-muted-foreground">
            {frozen === 1
              ? "1 part is kept as HTML"
              : `${frozen} parts are kept as HTML`}{" "}
            — edit those in place, or switch to HTML for the whole email.
          </span>
        ) : null}
      </div>

      {mode === "rich" ? (
        <RichTextEditor
          value={prepared.html}
          onChange={handleRichChange}
          placeholder={placeholder}
          variables={variables}
          showVariables={showVariables}
          onUploadImage={onUploadImage}
        />
      ) : (
        <div className="space-y-field">
          <textarea
            value={value}
            onChange={(event) => {
              // Not this component's own output, so the next switch back to
              // rich text has to re-read it.
              setEmitted(null);
              onChange(event.target.value);
            }}
            spellCheck={false}
            aria-label="HTML source"
            placeholder={
              placeholder ?? "Paste your HTML here — the preview updates as you type."
            }
            className="min-h-pane-lg w-full rounded-control border bg-background px-3 py-2 font-mono text-meta leading-relaxed text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-meta text-muted-foreground">
            {fullDocument
              ? "Sent exactly as written. Your document supplies its own styles, so nothing is wrapped around it."
              : "A fragment is wrapped in an email-safe layout on send. Paste a full document (with <html> or <body>) to send it untouched."}
          </p>
        </div>
      )}
    </div>
  );
}
