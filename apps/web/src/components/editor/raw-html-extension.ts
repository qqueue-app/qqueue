import { Node, mergeAttributes } from "@tiptap/core";

/** Fired at the editor container when a raw block asks to be edited. */
export const EDIT_RAW_EVENT = "qq-edit-raw";
/** Fired at the editor container when a raw block asks to be removed. */
export const DELETE_RAW_EVENT = "qq-delete-raw";

export interface RawBlockEventDetail {
  pos: number;
  html: string;
}

/**
 * Base64 rather than an HTML-escaped attribute value.
 *
 * The payload is arbitrary markup — quotes, ampersands, `<`, non-breaking
 * spaces, emoji — and it has to survive being written into an attribute,
 * serialized to a string, and parsed back. Escaping rules differ between
 * `setAttribute`, the HTML serializer and the parser in ways that are easy to
 * get subtly wrong, and getting it wrong corrupts the one thing this node
 * exists to protect. Base64 has no characters that mean anything to any of
 * them. Nobody reads it: the source view shows the expanded markup.
 */
export function encodeRaw(html: string): string {
  const bytes = new TextEncoder().encode(html);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function decodeRaw(payload: string): string {
  try {
    const binary = atob(payload);
    return new TextDecoder().decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0))
    );
  } catch {
    // A hand-edited or truncated payload is not worth throwing over: the block
    // renders empty and the author can retype it.
    return "";
  }
}

const UNSAFE_TAGS = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "base"
]);

/**
 * Strips anything that could execute from the *preview* of a raw block. The
 * stored markup is never touched — this only guards what gets put into the
 * page's own DOM.
 *
 * The shadow root the preview renders into isolates styles, not scripts: an
 * `<img onerror>` in a template written by one org member would run on the
 * screen of the next one to open it. The rest of the app avoids this by
 * previewing inside a `sandbox=""` iframe (see TemplatePreview), which is not
 * practical per-block because each one would have to be measured and resized.
 */
export function sanitizeForPreview(html: string): string {
  const holder = document.createElement("div");
  holder.innerHTML = html;

  for (const element of Array.from(holder.querySelectorAll("*"))) {
    if (UNSAFE_TAGS.has(element.tagName.toLowerCase())) {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.replace(/\s+/g, "").toLowerCase();
      if (name.startsWith("on") || value.startsWith("javascript:")) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  return holder.innerHTML;
}

/**
 * True when the markup renders nothing visible — a bare `<style>` block, or a
 * lone conditional comment. Those get a compact chip instead of an empty frame
 * with nothing in it.
 */
export function isInvisible(html: string): boolean {
  const holder = document.createElement("div");
  holder.innerHTML = sanitizeForPreview(html);
  for (const element of Array.from(holder.querySelectorAll("style, title"))) {
    element.remove();
  }
  return (
    holder.children.length === 0 && (holder.textContent ?? "").trim() === ""
  );
}

function summarize(html: string): string {
  const match = /<\s*([a-z][a-z0-9-]*)/i.exec(html);
  const tag = match?.[1]?.toLowerCase();
  if (!tag) return "HTML";
  if (tag === "style") return "<style> block";
  return `<${tag}> block`;
}

/**
 * Markup held verbatim, because the schema has no way to express it.
 *
 * This is what makes the rich text editor non-destructive over arbitrary HTML.
 * ProseMirror stores a document as schema nodes, so anything with no node —
 * a `<style>` block, an Outlook conditional comment, a `<font>` tag — is not
 * damaged on the way in, it is never stored at all. Keeping the original string
 * in an attribute of an atom node means the editor can hold a document it
 * cannot understand: the parts it knows stay editable, and the parts it doesn't
 * come back out exactly as they went in.
 *
 * The node renders as a placeholder `<div data-qq-raw>`; `expandRawBlocks` in
 * document-model.ts swaps those back for their payload on the way out.
 */
export const RawHtml = Node.create({
  name: "rawHtml",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      html: {
        default: "",
        parseHTML: (element) => decodeRaw(element.getAttribute("data-qq-raw") ?? ""),
        renderHTML: (attributes) => ({
          "data-qq-raw": encodeRaw(String(attributes.html ?? ""))
        })
      }
    };
  },

  parseHTML() {
    // Rule priority, not extension priority. Raising the extension's priority
    // would also move this node ahead of `paragraph` in the schema, and the
    // first block node in a schema is the one ProseMirror creates by default —
    // making a content-less atom the default block breaks Enter and lists. The
    // generic `div` container rules sit at the default 50, so 100 is enough to
    // claim the placeholder before they try to parse the payload as content.
    return [{ tag: "div[data-qq-raw]", priority: 100 }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ({ node, getPos }) => {
      const dom = document.createElement("div");
      dom.className = "qq-raw-block";
      dom.contentEditable = "false";
      dom.setAttribute("data-testid", "raw-html-block");

      const header = document.createElement("div");
      header.className = "qq-raw-block__bar";

      const label = document.createElement("span");
      label.className = "qq-raw-block__label";
      header.appendChild(label);

      function actionButton(text: string, event: string) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text;
        button.className = "qq-raw-block__action";
        button.addEventListener("click", () => {
          const pos = typeof getPos === "function" ? getPos() : null;
          if (pos === null || pos === undefined) return;
          dom.dispatchEvent(
            new CustomEvent<RawBlockEventDetail>(event, {
              bubbles: true,
              detail: { pos, html: String(node.attrs.html ?? "") }
            })
          );
        });
        return button;
      }

      header.appendChild(actionButton("Edit HTML", EDIT_RAW_EVENT));
      header.appendChild(actionButton("Remove", DELETE_RAW_EVENT));
      dom.appendChild(header);

      const preview = document.createElement("div");
      preview.className = "qq-raw-block__preview";
      // Styles inside the payload apply to the payload and nothing else, and
      // the app's own styles don't reach in to make the block look like
      // something it won't look like in a mail client.
      const shadow = preview.attachShadow({ mode: "open" });
      dom.appendChild(preview);

      function paint(html: string) {
        label.textContent = summarize(html);
        if (isInvisible(html)) {
          preview.hidden = true;
          dom.setAttribute("data-invisible", "");
          return;
        }
        preview.hidden = false;
        dom.removeAttribute("data-invisible");
        shadow.innerHTML = sanitizeForPreview(html);
      }

      paint(String(node.attrs.html ?? ""));

      return {
        dom,
        // Nothing inside is editable text, so ProseMirror should not try to map
        // DOM positions into it.
        ignoreMutation: () => true,
        stopEvent: (event: Event) => event.type === "click",
        update(updated) {
          if (updated.type.name !== "rawHtml") return false;
          paint(String(updated.attrs.html ?? ""));
          return true;
        },
        selectNode() {
          dom.classList.add("qq-raw-block--selected");
        },
        deselectNode() {
          dom.classList.remove("qq-raw-block--selected");
        }
      };
    };
  }
});
