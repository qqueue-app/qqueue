import { useEffect, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
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
import {
  CtaButton,
  type ButtonAlign,
  type ButtonFormValue
} from "./button-extension";
import { ButtonDialog } from "./ButtonDialog";
import { ImageDialog } from "./ImageDialog";

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
  placeholder?: string;
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
  onSubmit: (values: Record<string, string>) => void;
}

function EditorPromptDialog({
  config,
  onClose
}: {
  config: PromptConfig | null;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (config) {
      setValues(config.initial);
    }
  }, [config]);

  if (!config) {
    return null;
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, value.trim()])
    );
    if (config!.fields.some((field) => !trimmed[field.name])) {
      return;
    }
    config!.onSubmit(trimmed);
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
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true }
      }),
      Placeholder.configure({
        placeholder: placeholder ?? "Write your email…"
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      Color,
      Image.configure({
        inline: false,
        HTMLAttributes: { style: "max-width:100%;height:auto" }
      }),
      // Without these nodes in the schema, ProseMirror silently drops table
      // markup on paste — a pasted table was flattened to paragraphs before it
      // ever reached the send pipeline. Styles are inline rather than class-based
      // because mail clients strip <style> blocks, so a class-styled table would
      // arrive borderless.
      TableKit.configure({
        table: {
          resizable: false,
          HTMLAttributes: {
            style:
              "border-collapse:collapse;width:100%;border:1px solid #d4d4d8"
          }
        },
        tableCell: {
          HTMLAttributes: {
            style: "border:1px solid #d4d4d8;padding:6px 10px;vertical-align:top"
          }
        },
        tableHeader: {
          HTMLAttributes: {
            style:
              "border:1px solid #d4d4d8;padding:6px 10px;vertical-align:top;background-color:#f4f4f5;font-weight:600;text-align:left"
          }
        }
      }),
      CtaButton
    ],
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
      onChange(instance.getHTML());
    }
  });

  // Sync external value changes (e.g. opening the editor with existing content).
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

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

  function setLink() {
    const previous = editor!.getAttributes("link").href as string | undefined;
    setPrompt({
      title: previous ? "Edit link" : "Add link",
      description: "The selected text becomes a link to this address.",
      submitLabel: previous ? "Update link" : "Add link",
      fields: [
        {
          name: "href",
          label: "Link URL",
          type: "url",
          placeholder: "https://example.com"
        }
      ],
      initial: { href: previous ?? "https://" },
      removeLabel: "Remove link",
      onRemove: previous
        ? () => editor!.chain().focus().extendMarkRange("link").unsetLink().run()
        : undefined,
      onSubmit: ({ href }) =>
        editor!.chain().focus().extendMarkRange("link").setLink({ href }).run()
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
        if (clean) {
          editor!.chain().focus().insertContent(`{{${clean}}}`).run();
        }
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

      <EditorContent editor={editor} />

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
