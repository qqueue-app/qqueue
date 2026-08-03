import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Quote,
  Link as LinkIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Palette,
  Image as ImageIcon,
  RectangleHorizontal,
  Table as TableIcon,
  Rows3,
  Columns3,
  Minus,
  Braces,
  Code2,
  Undo,
  Redo
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import type { ButtonAlign, ButtonFormValue } from "./button-extension";
import { ButtonDialog } from "./ButtonDialog";
import { ImageDialog } from "./ImageDialog";
import { RawBlockDialog } from "./RawBlockDialog";
import { createExtensions } from "./editor-extensions";
import { holdsSameDocument } from "./document-model";
import {
  DELETE_RAW_EVENT,
  EDIT_RAW_EVENT,
  type RawBlockEventDetail
} from "./raw-html-extension";
import { normalizeUrl } from "./url";

const DEFAULT_VARIABLES = ["firstName", "lastName", "email"];

// Email-friendly text colours offered in the colour picker.
const TEXT_COLORS = [
  { label: "Default", value: null },
  { label: "Slate", value: "#1f2933" },
  { label: "Muted", value: "#627d98" },
  { label: "Green", value: "#2e7d63" },
  { label: "Blue", value: "#2563eb" },
  { label: "Red", value: "#dc2626" },
  { label: "Amber", value: "#d97706" }
];

interface PromptField {
  name: string;
  label: string;
  type?: string;
  inputMode?: "text" | "url" | "email";
  placeholder?: string;
  /** Blank is allowed — the submit handler supplies a fallback. */
  optional?: boolean;
  /**
   * Rewrites the trimmed input before anything sees it — returning `""` marks it
   * unusable, which fails the required check rather than reaching the editor.
   */
  normalize?: (value: string) => string;
}

// One dialog drives every toolbar action that needs to collect a value.
interface PromptConfig {
  title: string;
  description?: string;
  submitLabel: string;
  fields: PromptField[];
  initial: Record<string, string>;
  removeLabel?: string;
  onRemove?: () => void;
  /** Returns a message to keep the dialog open and show it; nothing to close. */
  onSubmit: (values: Record<string, string>) => string | void;
}

function EditorPromptDialog({
  config,
  onClose
}: {
  config: PromptConfig | null;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (config) {
      setValues(config.initial);
      setError(null);
    }
  }, [config]);

  if (!config) {
    return null;
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    // The dialog is portaled out of the DOM but not out of the React tree, so
    // React keeps bubbling this submit up to whatever page form the editor sits
    // inside. That form then ran its own handler: adding a link saved and left
    // the template, and in Email Studio it would have sent the message.
    event.stopPropagation();
    const fields = config!.fields;
    const cleaned = Object.fromEntries(
      Object.entries(values).map(([key, value]) => {
        const field = fields.find((candidate) => candidate.name === key);
        const trimmed = value.trim();
        return [key, field?.normalize ? field.normalize(trimmed) : trimmed];
      })
    );
    // Never close on an input the editor can't act on — the dialog used to
    // report success and leave the document untouched.
    const missing = fields.find(
      (field) => !field.optional && !cleaned[field.name]
    );
    if (missing) {
      setError(`${missing.label} is required.`);
      return;
    }
    // The same applies one step later: a command ProseMirror refuses is a
    // no-op, and closing on it would claim an edit that never happened.
    const failure = config!.onSubmit(cleaned);
    if (failure) {
      setError(failure);
      return;
    }
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          {config.description ? (
            <DialogDescription>{config.description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {config.fields.map((field, index) => (
            <div key={field.name} className="space-y-2">
              <Label htmlFor={`editor-prompt-${field.name}`}>{field.label}</Label>
              <Input
                id={`editor-prompt-${field.name}`}
                type={field.type ?? "text"}
                inputMode={field.inputMode}
                autoComplete="off"
                spellCheck={false}
                placeholder={field.placeholder}
                autoFocus={index === 0}
                value={values[field.name] ?? ""}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field.name]: event.target.value
                  }))
                }
              />
            </div>
          ))}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            {config.onRemove ? (
              <Button
                type="button"
                variant="outline"
                className="sm:mr-auto"
                onClick={() => {
                  config.onRemove?.();
                  onClose();
                }}
              >
                {config.removeLabel ?? "Remove"}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">{config.submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  variables?: string[];
  showVariables?: boolean;
  className?: string;
  /**
   * Uploads an image and resolves to its public URL. When omitted the image
   * dialog only offers linking, so the editor stays usable without an
   * organization context.
   */
  onUploadImage?: (file: File) => Promise<string>;
}

function ToolbarButton({
  onClick,
  active,
  disabled,
  label,
  children
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4",
        active && "bg-primary/10 text-primary"
      )}
    >
      {children}
    </button>
  );
}

function ColorMenu({ editor }: { editor: Editor }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          aria-label="Text colour"
          title="Text colour"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-4"
        >
          <Palette />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Text colour</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {TEXT_COLORS.map((color) => (
          <DropdownMenuItem
            key={color.label}
            onSelect={() => {
              if (color.value) {
                editor.chain().focus().setColor(color.value).run();
              } else {
                editor.chain().focus().unsetColor().run();
              }
            }}
          >
            <span
              className="mr-2 inline-block h-3.5 w-3.5 rounded-full border"
              style={{ backgroundColor: color.value ?? "transparent" }}
            />
            {color.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function VariableMenu({
  editor,
  variables,
  onInsertCustom
}: {
  editor: Editor;
  variables: string[];
  onInsertCustom: () => void;
}) {
  function insert(name: string) {
    editor.chain().focus().insertContent(`{{${name}}}`).run();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5">
          <Braces className="h-4 w-4" />
          Variable
        </Button>
      </DropdownMenuTrigger>
      {/* Focus goes to the editor or the dialog, never back to the trigger. */}
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DropdownMenuLabel>Insert variable</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {variables.map((variable) => (
          <DropdownMenuItem key={variable} onSelect={() => insert(variable)}>
            <code className="text-xs">{`{{${variable}}}`}</code>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onInsertCustom}>Custom…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  variables = DEFAULT_VARIABLES,
  showVariables = true,
  className,
  onUploadImage
}: RichTextEditorProps) {
  const [prompt, setPrompt] = useState<PromptConfig | null>(null);
  const [imageOpen, setImageOpen] = useState(false);
  const [buttonOpen, setButtonOpen] = useState(false);
  // `pos: null` means "inserting a new block" rather than editing one in place.
  const [rawEdit, setRawEdit] = useState<{
    pos: number | null;
    html: string;
  } | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  // The document the editor is holding, as of the last time anyone looked: what
  // it was handed at mount or by the sync effect below, then whatever it reports
  // afterwards.
  //
  // Loading a document dispatches transactions of its own — the trailing node
  // appends an empty paragraph after a document ending in a table so there is
  // somewhere to carry on typing — and those arrive at `onUpdate` looking like
  // an edit. Passed on as one, opening a template would mark it dirty before the
  // author had touched it. So the first updates are checked against what was
  // loaded and dropped while they still say the same thing; once something real
  // lands, the author is editing and the check is not needed again.
  const loaded = useRef(value);
  const edited = useRef(false);
  const editor = useEditor({
    // Shared with the partitioner that decides what may be loaded into this
    // editor. The two have to be the same schema or the partitioner's answer is
    // about a different editor than the one on screen.
    extensions: createExtensions({ placeholder }),
    content: value,
    // The toolbar reads editor.isActive(...) during render for its active
    // states (bold, alignment, "Edit button", the table controls). Tiptap v3
    // defaults this to false, which leaves every one of those stale — the
    // row/column controls never appear and highlights never update.
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none min-h-[200px] px-3 py-2 focus:outline-none prose-headings:font-semibold prose-a:text-primary"
      }
    },
    onUpdate: ({ editor: instance }) => {
      const html = instance.getHTML();
      const previous = loaded.current;
      loaded.current = html;
      if (!edited.current) {
        if (holdsSameDocument(html, previous)) return;
        edited.current = true;
      }
      onChange(html);
    }
  });

  // Sync external value changes (e.g. opening the editor with existing content).
  //
  // Compared against what was last loaded rather than against the editor's
  // current HTML: those differ wherever the schema wrote the document back in
  // its own hand, and re-setting the content over a difference the editor itself
  // introduced would throw away the author's selection and undo history.
  useEffect(() => {
    if (!editor || value === loaded.current) return;
    loaded.current = value;
    edited.current = false;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editor]);

  // Raw blocks are plain DOM inside a node view, with no React tree of their
  // own to hang a handler on, so their controls announce themselves by event
  // and the editor answers on their behalf.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !editor) return;

    function detailOf(event: Event) {
      return (event as CustomEvent<RawBlockEventDetail>).detail;
    }

    function edit(event: Event) {
      setRawEdit(detailOf(event));
    }

    function remove(event: Event) {
      const { pos } = detailOf(event);
      const target = editor!.state.doc.nodeAt(pos);
      if (!target) return;
      editor!
        .chain()
        .focus()
        .deleteRange({ from: pos, to: pos + target.nodeSize })
        .run();
    }

    surface.addEventListener(EDIT_RAW_EVENT, edit);
    surface.addEventListener(DELETE_RAW_EVENT, remove);
    return () => {
      surface.removeEventListener(EDIT_RAW_EVENT, edit);
      surface.removeEventListener(DELETE_RAW_EVENT, remove);
    };
  }, [editor]);

  if (!editor) {
    return null;
  }

  // With a button selected the toolbar control edits it in place instead of
  // inserting a second one.
  const buttonSelected = editor.isActive("ctaButton");

  // The button is inline, so its placement is the alignment of the line it
  // sits on — seed the dialog from that rather than forcing a default.
  const currentAlign: ButtonAlign = editor.isActive({ textAlign: "center" })
    ? "center"
    : editor.isActive({ textAlign: "right" })
      ? "right"
      : "left";

  /**
   * The link control has three jobs, decided by what is under the cursor. Two of
   * them used to fall through to `setLink` on a selection that can't hold a mark,
   * which ProseMirror discards — the dialog reported success and the document was
   * left untouched.
   *
   * - `button`  — a CTA button owns its own href and takes no marks at all, so
   *               retarget the node instead of marking it.
   * - `insert`  — nothing selected: a link mark on an empty selection is only a
   *               stored mark, dropped as soon as the selection moves. Collect
   *               the visible text and insert real linked text.
   * - `mark`    — text is selected, or the cursor sits in an existing link
   *               (which `extendMarkRange` grows back out to).
   */
  function setLink() {
    const existing = editor!.getAttributes("link").href as string | undefined;
    const mode = editor!.isActive("ctaButton")
      ? "button"
      : !existing && editor!.state.selection.empty
        ? "insert"
        : "mark";

    const copy = {
      button: {
        title: "Button link",
        description: "Where the selected button sends the reader.",
        submitLabel: "Update button link"
      },
      insert: {
        title: "Insert link",
        description:
          "Nothing is selected, so this inserts a new link where the cursor is.",
        submitLabel: "Insert link"
      },
      mark: {
        title: existing ? "Edit link" : "Add link",
        description: "The selected text becomes a link to this address.",
        submitLabel: existing ? "Update link" : "Add link"
      }
    }[mode];

    const currentHref =
      mode === "button"
        ? (editor!.getAttributes("ctaButton").href as string | undefined)
        : existing;

    setPrompt({
      ...copy,
      fields: [
        {
          name: "href",
          label: "Link URL",
          // Deliberately not type="url": the browser would reject "example.com"
          // before the form submitted, and that is what people type. The scheme
          // is filled in by normalizeUrl instead of being demanded.
          inputMode: "url",
          placeholder: "example.com",
          normalize: normalizeUrl
        },
        ...(mode === "insert"
          ? [
              {
                name: "text",
                label: "Link text",
                placeholder: "Defaults to the URL",
                optional: true
              }
            ]
          : [])
      ],
      // Empty rather than an "https://" stub: the placeholder says more, and a
      // stub left untouched used to sail through the required check and link
      // the text to nothing.
      initial: { href: currentHref ?? "", text: "" },
      removeLabel: "Remove link",
      onRemove:
        mode === "mark" && existing
          ? () =>
              editor!.chain().focus().extendMarkRange("link").unsetLink().run()
          : undefined,
      onSubmit: ({ href, text }) => {
        const applied = (() => {
          if (mode === "button") {
            return editor!.chain().focus().updateCtaButton({ href }).run();
          }
          if (mode === "insert") {
            return (
              editor!
                .chain()
                .focus()
                .insertContent({
                  type: "text",
                  text: text || href,
                  marks: [{ type: "link", attrs: { href } }]
                })
                // Without this the mark stays stored and whatever is typed next
                // joins the link.
                .unsetMark("link")
                .run()
            );
          }
          return editor!
            .chain()
            .focus()
            .extendMarkRange("link")
            .setLink({ href })
            .run();
        })();

        if (!applied) {
          return "That address can't be linked. Try a full web address.";
        }
      }
    });
  }

  function insertCustomVariable() {
    setPrompt({
      title: "Insert variable",
      description:
        "Use letters, numbers, dots, dashes and underscores. Anything else is stripped.",
      submitLabel: "Insert variable",
      fields: [
        { name: "name", label: "Variable name", placeholder: "company.name" }
      ],
      initial: { name: "" },
      onSubmit: ({ name }) => {
        const clean = name.replace(/[^\w.-]/g, "");
        if (!clean) {
          return "That leaves nothing usable — try letters, numbers, dots, dashes or underscores.";
        }
        editor!.chain().focus().insertContent(`{{${clean}}}`).run();
      }
    });
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-input bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 p-1.5">
        <ToolbarButton
          label="Bold"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold />
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic />
        </ToolbarButton>
        <ToolbarButton
          label="Underline"
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon />
        </ToolbarButton>
        <ToolbarButton
          label="Strikethrough"
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough />
        </ToolbarButton>
        <ColorMenu editor={editor} />

        <Separator orientation="vertical" className="mx-1 h-6" />

        <ToolbarButton
          label="Heading 1"
          active={editor.isActive("heading", { level: 1 })}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
        >
          <Heading1 />
        </ToolbarButton>
        <ToolbarButton
          label="Heading 2"
          active={editor.isActive("heading", { level: 2 })}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          <Heading2 />
        </ToolbarButton>
        <ToolbarButton
          label="Bullet list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List />
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered />
        </ToolbarButton>
        <ToolbarButton
          label="Quote"
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote />
        </ToolbarButton>

        <Separator orientation="vertical" className="mx-1 h-6" />

        <ToolbarButton
          label="Align left"
          active={editor.isActive({ textAlign: "left" })}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
        >
          <AlignLeft />
        </ToolbarButton>
        <ToolbarButton
          label="Align centre"
          active={editor.isActive({ textAlign: "center" })}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
        >
          <AlignCenter />
        </ToolbarButton>
        <ToolbarButton
          label="Align right"
          active={editor.isActive({ textAlign: "right" })}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
        >
          <AlignRight />
        </ToolbarButton>

        <Separator orientation="vertical" className="mx-1 h-6" />

        <ToolbarButton label="Link" active={editor.isActive("link")} onClick={setLink}>
          <LinkIcon />
        </ToolbarButton>
        <ToolbarButton label="Image" onClick={() => setImageOpen(true)}>
          <ImageIcon />
        </ToolbarButton>
        {/* Labelled rather than icon-only: an icon alone made this hard to
            find, and it doubles as "edit" when a button is selected. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setButtonOpen(true)}
          aria-label={buttonSelected ? "Edit button" : "Button"}
          className={cn(
            "h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground",
            buttonSelected && "bg-primary/10 text-primary"
          )}
        >
          <RectangleHorizontal className="h-4 w-4" />
          {buttonSelected ? "Edit button" : "Button"}
        </Button>
        <ToolbarButton
          label={
            editor.isActive("table") ? "Delete table" : "Insert table (3×3)"
          }
          active={editor.isActive("table")}
          onClick={() => {
            if (editor.isActive("table")) {
              editor.chain().focus().deleteTable().run();
              return;
            }
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run();
          }}
        >
          <TableIcon />
        </ToolbarButton>
        {editor.isActive("table") ? (
          <>
            <ToolbarButton
              label="Add row"
              onClick={() => editor.chain().focus().addRowAfter().run()}
            >
              <Rows3 />
            </ToolbarButton>
            <ToolbarButton
              label="Add column"
              onClick={() => editor.chain().focus().addColumnAfter().run()}
            >
              <Columns3 />
            </ToolbarButton>
          </>
        ) : null}
        <ToolbarButton
          label="Divider"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        >
          <Minus />
        </ToolbarButton>
        {/* Dropping a snippet in no longer means abandoning the editor for the
            source view: it lands as a block that keeps its own markup. */}
        <ToolbarButton
          label="HTML block"
          onClick={() => setRawEdit({ pos: null, html: "" })}
        >
          <Code2 />
        </ToolbarButton>

        <Separator orientation="vertical" className="mx-1 h-6" />

        <ToolbarButton
          label="Undo"
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo />
        </ToolbarButton>
        <ToolbarButton
          label="Redo"
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo />
        </ToolbarButton>

        {showVariables ? (
          <div className="ml-auto">
            <VariableMenu
              editor={editor}
              variables={variables}
              onInsertCustom={insertCustomVariable}
            />
          </div>
        ) : null}
      </div>

      <div ref={surfaceRef}>
        <EditorContent editor={editor} />
      </div>

      <RawBlockDialog
        open={rawEdit !== null}
        initial={rawEdit?.html ?? ""}
        editing={rawEdit?.pos !== null && rawEdit?.pos !== undefined}
        onClose={() => setRawEdit(null)}
        onSubmit={(html) => {
          const pos = rawEdit?.pos;
          if (pos === null || pos === undefined) {
            editor.chain().focus().insertContent({ type: "rawHtml", attrs: { html } }).run();
          } else {
            editor
              .chain()
              .focus()
              .command(({ tr }) => {
                tr.setNodeAttribute(pos, "html", html);
                return true;
              })
              .run();
          }
          setRawEdit(null);
        }}
      />

      <EditorPromptDialog config={prompt} onClose={() => setPrompt(null)} />
      <ImageDialog
        open={imageOpen}
        onClose={() => setImageOpen(false)}
        onUpload={onUploadImage}
        onInsert={(src) => editor.chain().focus().setImage({ src }).run()}
      />
      <ButtonDialog
        open={buttonOpen}
        initial={
          buttonSelected
            ? ({
                ...editor.getAttributes("ctaButton"),
                align: currentAlign
              } as Partial<ButtonFormValue>)
            : undefined
        }
        currentAlign={currentAlign}
        onClose={() => setButtonOpen(false)}
        onSubmit={({ align, ...attrs }) => {
          const chain = editor.chain().focus();
          if (buttonSelected) {
            chain.updateCtaButton(attrs);
          } else {
            chain.setCtaButton(attrs);
          }
          // Alignment lives on the paragraph, not the button — so only touch
          // it when the user actually changed it, or inserting a button beside
          // text would restamp that line's alignment.
          if (align !== currentAlign) {
            chain.setTextAlign(align);
          }
          chain.run();
        }}
      />
    </div>
  );
}
