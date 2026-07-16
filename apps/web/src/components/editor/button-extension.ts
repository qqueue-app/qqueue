import { mergeAttributes, Node } from "@tiptap/core";

export type ButtonAlign = "left" | "center" | "right";
export type ButtonSize = "small" | "medium" | "large";
export type ButtonRadius = "sharp" | "rounded" | "pill";

/**
 * Attributes stored on the button node itself. Alignment is deliberately not
 * one of them: the button is inline, so where it sits is a property of the
 * line it flows in (the paragraph's `text-align`), not of the button.
 */
export interface ButtonAttributes {
  href: string;
  label: string;
  background: string;
  color: string;
  size: ButtonSize;
  radius: ButtonRadius;
}

/** What the button dialog collects: node attributes plus the line's alignment. */
export interface ButtonFormValue extends ButtonAttributes {
  align: ButtonAlign;
}

export const BUTTON_DEFAULTS: ButtonAttributes = {
  href: "https://",
  label: "Click here",
  background: "#2e7d63",
  color: "#ffffff",
  size: "medium",
  radius: "rounded"
};

export const BUTTON_ALIGNMENTS: ButtonAlign[] = ["left", "center", "right"];

const SIZE_STYLES: Record<ButtonSize, { padding: string; fontSize: string }> = {
  small: { padding: "8px 16px", fontSize: "14px" },
  medium: { padding: "12px 22px", fontSize: "15px" },
  large: { padding: "16px 30px", fontSize: "17px" }
};

const RADIUS_STYLES: Record<ButtonRadius, string> = {
  sharp: "0",
  rounded: "8px",
  pill: "999px"
};

/**
 * Colours land in an inline `style` attribute, so only literal hex values are
 * accepted — anything else falls back to the default rather than being passed
 * through into CSS.
 */
export function normalizeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value)
    ? value
    : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === "string" && (allowed as string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function normalizeButtonAttributes(
  attrs: Partial<ButtonAttributes>
): ButtonAttributes {
  return {
    href: typeof attrs.href === "string" ? attrs.href : BUTTON_DEFAULTS.href,
    label:
      typeof attrs.label === "string" && attrs.label.trim()
        ? attrs.label
        : BUTTON_DEFAULTS.label,
    background: normalizeColor(attrs.background, BUTTON_DEFAULTS.background),
    color: normalizeColor(attrs.color, BUTTON_DEFAULTS.color),
    size: oneOf<ButtonSize>(
      attrs.size,
      ["small", "medium", "large"],
      BUTTON_DEFAULTS.size
    ),
    radius: oneOf<ButtonRadius>(
      attrs.radius,
      ["sharp", "rounded", "pill"],
      BUTTON_DEFAULTS.radius
    )
  };
}

/**
 * Inline styles are required: email clients strip <style>/class rules, so the
 * button must carry its appearance on the element itself.
 *
 * Note what is *absent*: font-weight. Bold's parse rule matches a bare
 * `font-weight` style on any element, so a weight here would be read back as a
 * bold mark and wrap the button in <strong> every time content is reopened. It
 * lives on the inner label span instead, which the parser never descends into
 * because this node is an atom.
 */
export function buttonStyle(attrs: ButtonAttributes): string {
  const size = SIZE_STYLES[attrs.size];
  return [
    "display:inline-block",
    `background:${attrs.background}`,
    `color:${attrs.color}`,
    `padding:${size.padding}`,
    `border-radius:${RADIUS_STYLES[attrs.radius]}`,
    "text-decoration:none",
    `font-size:${size.fontSize}`
  ].join(";");
}

/** Kept off the anchor so Bold can't parse it back — see `buttonStyle`. */
export const BUTTON_LABEL_STYLE = "font-weight:600";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    ctaButton: {
      /** Insert a call-to-action button block. */
      setCtaButton: (attrs: Partial<ButtonAttributes>) => ReturnType;
      /** Restyle/retarget the button under the current selection. */
      updateCtaButton: (attrs: Partial<ButtonAttributes>) => ReturnType;
    };
  }
}

/**
 * A call-to-action button rendered as an email-safe, inline-styled anchor.
 * Stored in the document as `<a data-qq-button>` so it round-trips through the
 * template HTML and survives the send pipeline unchanged.
 *
 * Inline rather than block: a block node can only ever occupy its own line, so
 * the button could never sit beside text. As an inline atom it flows with the
 * surrounding content, and a button that should stand alone is simply the only
 * thing in its paragraph — aligned by that paragraph's `text-align`, which the
 * TextAlign extension already owns and parses.
 *
 * Appearance is stored as `data-qq-*` attributes alongside the inline styles.
 * Parsing reads those attributes rather than re-parsing CSS, so a button keeps
 * its settings across a save/load cycle. Buttons written before those
 * attributes existed fall back to the defaults, which reproduce the original
 * green button, and their wrapper's `text-align` is picked up by TextAlign as
 * ordinary paragraph alignment.
 */
export const CtaButton = Node.create({
  name: "ctaButton",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  // The button carries `font-weight:600` in its own inline style, which Bold
  // otherwise parses back as a bold mark — wrapping the button in <strong> on
  // every reopen. It styles itself completely, so it takes no marks at all.
  marks: "",

  addAttributes() {
    return {
      href: {
        default: BUTTON_DEFAULTS.href,
        parseHTML: (element) => element.getAttribute("href")
      },
      label: {
        default: BUTTON_DEFAULTS.label,
        parseHTML: (element) => element.textContent
      },
      background: {
        default: BUTTON_DEFAULTS.background,
        parseHTML: (element) => element.getAttribute("data-qq-bg")
      },
      color: {
        default: BUTTON_DEFAULTS.color,
        parseHTML: (element) => element.getAttribute("data-qq-color")
      },
      size: {
        default: BUTTON_DEFAULTS.size,
        parseHTML: (element) => element.getAttribute("data-qq-size")
      },
      radius: {
        default: BUTTON_DEFAULTS.radius,
        parseHTML: (element) => element.getAttribute("data-qq-radius")
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: "a[data-qq-button]",
        // Beats StarterKit's Link, which also matches this anchor. The
        // priority must live on the rule, not the extension: extension
        // priority also reorders the schema, and this node holds no content,
        // so promoting it there breaks unrelated commands.
        priority: 1100
      }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { href, label, background, color, size, radius, ...rest } =
      HTMLAttributes as Record<string, unknown>;
    const attrs = normalizeButtonAttributes({
      href: href as string,
      label: label as string,
      background: background as string,
      color: color as string,
      size: size as ButtonSize,
      radius: radius as ButtonRadius
    });

    return [
      "a",
      mergeAttributes(rest, {
        href: attrs.href,
        "data-qq-button": "true",
        "data-qq-bg": attrs.background,
        "data-qq-color": attrs.color,
        "data-qq-size": attrs.size,
        "data-qq-radius": attrs.radius,
        target: "_blank",
        rel: "noopener noreferrer",
        style: buttonStyle(attrs)
      }),
      ["span", { style: BUTTON_LABEL_STYLE }, attrs.label]
    ];
  },

  addCommands() {
    return {
      setCtaButton:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: normalizeButtonAttributes(attrs)
          }),
      updateCtaButton:
        (attrs) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, attrs)
    };
  }
});
