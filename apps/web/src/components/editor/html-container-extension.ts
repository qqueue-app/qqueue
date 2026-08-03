import { Node, mergeAttributes } from "@tiptap/core";

/**
 * Wrapper tags email HTML is built out of. None of them mean anything on their
 * own — they exist to carry width, padding, background and alignment — so the
 * editor can hold them generically: keep the tag name and the attributes, treat
 * the contents as ordinary editable content.
 *
 * Without these the schema had no wrapper node at all, so every exported email
 * (which is wrappers all the way down) was unrepresentable from its first tag.
 */
export const CONTAINER_TAGS = [
  "div",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "aside",
  "nav",
  "center",
  "figure",
  "figcaption",
  "address"
];

const BLOCK_CHILD_TAGS = new Set([
  ...CONTAINER_TAGS,
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "hr",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th"
]);

/** True when the element holds element children rather than just text/inline. */
function hasBlockChildren(element: HTMLElement): boolean {
  return Array.from(element.children).some((child) =>
    // `display` is unreliable here (jsdom has no layout, and the element is
    // detached), so go by the tag: these are the ones ProseMirror parses into
    // block nodes, and anything else stays inline.
    BLOCK_CHILD_TAGS.has(child.tagName.toLowerCase())
  );
}

function containerRules(wantsBlockChildren: boolean) {
  return CONTAINER_TAGS.map((tag) => ({
    tag,
    // Declining with `false` hands the element to the other variant. Between
    // them the two cover every container, and neither can claim one the other
    // would mangle: a wrapper holding paragraphs cannot be parsed as inline
    // content, and a wrapper holding a sentence must not gain a `<p>` it never
    // had — inside a padded cell that is a visible change in spacing.
    getAttrs: (element: HTMLElement) =>
      hasBlockChildren(element) === wantsBlockChildren
        ? { tag: element.tagName.toLowerCase() }
        : false
  }));
}

const tagAttribute = {
  tag: {
    default: "div",
    // Carried in the node, not in the output — `renderHTML` below uses it as
    // the element name, so emitting it as an attribute too would produce
    // `<div tag="div">`.
    rendered: false
  }
};

/**
 * A layout wrapper holding block content: `<div>`, `<center>`, `<section>`…
 *
 * Everything about the element except its children is preserved (the tag name
 * here, its attributes by the preserved-attributes extension), so it comes back
 * out identical while its contents stay fully editable. This is what lets a
 * pasted email export be typed into rather than frozen behind a source view.
 */
export const HtmlBlock = Node.create({
  name: "htmlBlock",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes: () => tagAttribute,
  parseHTML: () => containerRules(true),
  renderHTML: ({ node, HTMLAttributes }) => [
    String(node.attrs.tag ?? "div"),
    mergeAttributes(HTMLAttributes),
    0
  ]
});

/**
 * The same wrapper holding inline content: `<div style="…">One line</div>`.
 *
 * Separate from `HtmlBlock` because ProseMirror nodes are either textblocks or
 * block containers, never both, and a container would wrap that sentence in a
 * paragraph on the way in.
 */
export const HtmlText = Node.create({
  name: "htmlText",
  group: "block",
  content: "inline*",

  addAttributes: () => tagAttribute,
  parseHTML: () => containerRules(false),
  renderHTML: ({ node, HTMLAttributes }) => [
    String(node.attrs.tag ?? "div"),
    mergeAttributes(HTMLAttributes),
    0
  ]
});
