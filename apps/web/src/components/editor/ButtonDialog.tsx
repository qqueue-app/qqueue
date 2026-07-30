import { useEffect, useRef, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  BUTTON_DEFAULTS,
  BUTTON_LABEL_STYLE,
  buttonStyle,
  normalizeButtonAttributes,
  type ButtonAlign,
  type ButtonFormValue,
  type ButtonRadius,
  type ButtonSize
} from "./button-extension";
import { normalizeUrl } from "./url";

// Email-safe presets, matching the editor's text colour palette.
const BACKGROUND_SWATCHES = [
  "#2e7d63",
  "#2563eb",
  "#1f2933",
  "#dc2626",
  "#d97706",
  "#7c3aed"
];
const TEXT_SWATCHES = ["#ffffff", "#1f2933"];

const ALIGN_OPTIONS: { value: ButtonAlign; label: string; icon: typeof AlignLeft }[] =
  [
    { value: "left", label: "Align left", icon: AlignLeft },
    { value: "center", label: "Align centre", icon: AlignCenter },
    { value: "right", label: "Align right", icon: AlignRight }
  ];

const SIZE_OPTIONS: { value: ButtonSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" }
];

const RADIUS_OPTIONS: { value: ButtonRadius; label: string }[] = [
  { value: "sharp", label: "Sharp" },
  { value: "rounded", label: "Rounded" },
  { value: "pill", label: "Pill" }
];

/** Turns an inline-style string into the object form React wants. */
function toReactStyle(style: string): React.CSSProperties {
  return Object.fromEntries(
    style.split(";").map((rule) => {
      const [property, value] = rule.split(":");
      return [
        property!.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase()),
        value!
      ];
    })
  );
}

/** A segmented control — the app has no Tabs primitive, and this reads better
 *  than a select for three visual choices. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  groupLabel
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  groupLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={groupLabel}
      className="inline-flex rounded-md border bg-muted/40 p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded px-3 py-1 text-sm transition-colors",
            value === option.value
              ? "bg-card font-medium text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ColorField({
  id,
  label,
  value,
  swatches,
  onChange
}: {
  id: string;
  label: string;
  value: string;
  swatches: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-12 cursor-pointer rounded border bg-card p-0.5"
        />
        {swatches.map((swatch) => (
          <button
            key={swatch}
            type="button"
            aria-label={`${label}: ${swatch}`}
            onClick={() => onChange(swatch)}
            style={{ backgroundColor: swatch }}
            className={cn(
              "h-6 w-6 rounded-full border transition-transform hover:scale-110",
              value.toLowerCase() === swatch.toLowerCase() &&
                "ring-2 ring-ring ring-offset-1 ring-offset-background"
            )}
          />
        ))}
      </div>
    </div>
  );
}

interface ButtonDialogProps {
  open: boolean;
  /** The button being edited plus its line's alignment; omit to insert. */
  initial?: Partial<ButtonFormValue>;
  /** Alignment of the line the button will be inserted into. */
  currentAlign?: ButtonAlign;
  onClose: () => void;
  onSubmit: (value: ButtonFormValue) => void;
}

export function ButtonDialog({
  open,
  initial,
  currentAlign = "left",
  onClose,
  onSubmit
}: ButtonDialogProps) {
  const editing = Boolean(initial);
  const [attrs, setAttrs] = useState<ButtonFormValue>({
    ...BUTTON_DEFAULTS,
    align: currentAlign
  });

  const [error, setError] = useState<string | null>(null);

  // Seeded once per opening. `initial` is rebuilt by the caller on every render
  // (it reads live editor attributes), so reseeding on every change would throw
  // away whatever the user had typed the moment anything re-rendered.
  const seeded = useRef(false);

  useEffect(() => {
    if (!open) {
      seeded.current = false;
      return;
    }
    if (!seeded.current) {
      seeded.current = true;
      setError(null);
      const { align, ...rest } = initial ?? {};
      setAttrs({
        ...normalizeButtonAttributes({
          ...BUTTON_DEFAULTS,
          label: initial ? BUTTON_DEFAULTS.label : "Get started",
          // A new button starts with an empty address rather than an "https://"
          // stub, so the placeholder can show what the field will take.
          href: initial ? BUTTON_DEFAULTS.href : "",
          ...rest
        }),
        // Default to the line's existing alignment so inserting a button
        // beside text never silently re-aligns that text.
        align: align ?? currentAlign
      });
    }
  }, [open, initial, currentAlign]);

  function set<K extends keyof ButtonFormValue>(
    key: K,
    value: ButtonFormValue[K]
  ) {
    setError(null);
    setAttrs((current) => ({ ...current, [key]: value }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    // Portaled out of the DOM but not out of the React tree, so without this
    // the submit reaches the page form the editor sits inside — saving the
    // template, or sending the message, from behind the dialog.
    event.stopPropagation();
    // "example.com" is what people type; stored as-is it would be a relative
    // link that resolves against the mail client rather than the web.
    const href = normalizeUrl(attrs.href);
    const label = attrs.label.trim();
    // Refusing used to be silent, which is the same experience as the dialog
    // being broken — say which field is holding it up instead.
    if (!href) {
      setError("Add the address the button should open.");
      return;
    }
    if (!label) {
      setError("Give the button some text.");
      return;
    }
    onSubmit({
      ...normalizeButtonAttributes({ ...attrs, href, label }),
      align: attrs.align
    });
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit button" : "Insert button"}</DialogTitle>
          <DialogDescription>
            A call-to-action button that renders in every email client.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="button-label">Button text</Label>
            <Input
              id="button-label"
              value={attrs.label}
              onChange={(event) => set("label", event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="button-href">Button URL</Label>
            {/* Deliberately not type="url": the browser rejects "example.com"
                before the form submits, and that is what people type. The
                scheme is filled in on submit instead of being demanded. */}
            <Input
              id="button-href"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="example.com"
              value={attrs.href}
              onChange={(event) => set("href", event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Alignment</Label>
            <p className="text-xs text-muted-foreground">
              Aligns the whole line. A button sitting beside text moves with it.
            </p>
            <div
              role="group"
              aria-label="Alignment"
              className="inline-flex rounded-md border bg-muted/40 p-0.5"
            >
              {ALIGN_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-label={option.label}
                  aria-pressed={attrs.align === option.value}
                  onClick={() => set("align", option.value)}
                  className={cn(
                    "inline-flex h-7 w-9 items-center justify-center rounded transition-colors [&_svg]:size-4",
                    attrs.align === option.value
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <option.icon />
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <ColorField
              id="button-bg"
              label="Background"
              value={attrs.background}
              swatches={BACKGROUND_SWATCHES}
              onChange={(value) => set("background", value)}
            />
            <ColorField
              id="button-color"
              label="Text colour"
              value={attrs.color}
              swatches={TEXT_SWATCHES}
              onChange={(value) => set("color", value)}
            />
          </div>

          <div className="flex flex-wrap gap-4">
            <div className="space-y-2">
              <Label>Size</Label>
              <Segmented
                groupLabel="Size"
                value={attrs.size}
                options={SIZE_OPTIONS}
                onChange={(value) => set("size", value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Corners</Label>
              <Segmented
                groupLabel="Corners"
                value={attrs.radius}
                options={RADIUS_OPTIONS}
                onChange={(value) => set("radius", value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Preview</Label>
            <div
              className="rounded-md border bg-white p-4"
              style={{ textAlign: attrs.align }}
            >
              {/* Built from the same style functions the email uses — including
                  the anchor/label split — so the preview can't drift from the
                  sent result. */}
              <span style={toReactStyle(buttonStyle(attrs))}>
                <span style={toReactStyle(BUTTON_LABEL_STYLE)}>
                  {attrs.label || "Button"}
                </span>
              </span>
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              {editing ? "Save button" : "Insert button"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
