# Tiptap editor — the traps

These are the non-obvious constraints in this directory. Each one caused a real
bug and each has a regression test. Read before changing the schema, the
partitioner, or a dialog.

## `BodyEditor` splits a document rather than refusing the editor for it

(`partition.ts`, `document-model.ts`.) Mounting Tiptap over markup its schema
can't hold rewrites that markup on sight — a `<div>` layout, a class-styled
table, a `<style>` block — and getting it wrong looks exactly like saves
silently failing. So a document's `<head>`/scaffold is kept as two literal
strings and put back, regions the schema can't represent become **raw blocks**
holding their markup verbatim, and the rest stays editable. Rich ↔ HTML is
lossless both ways; there is no mode lock and no allowlist.

## What the schema can hold is asked of the schema, never listed

`partitionForSchema` parses through the real schema, serializes back, and
compares the two DOM trees (`dom-equivalence.ts`); whatever came back different
is frozen and the pass repeats. The editor and the partitioner build from one
extension list (`editor-extensions.ts`) and **must** keep sharing it. A
hand-maintained tag/attribute allowlist is a second copy of the schema and
drifts from it — that is what this replaced. Erring toward "different" is safe:
a false difference costs editability, a false match costs the author's layout.

## Loading a document is not editing it

The schema writes attributes back in its own hand, and the trailing node appends
an empty paragraph after a document ending in a table — all as ordinary
transactions. `RichTextEditor` drops those updates until one says something new
(`holdsSameDocument`), or opening a template marks it dirty before the author
has touched it. Covered by BodyEditor.test.tsx's "opening a document" block.

## Every editor dialog's `<form>` must `stopPropagation()` on submit

Radix portals a dialog out of the DOM but *not* out of the React tree, so React
bubbles its submit into whatever page form the editor sits in — `TemplateEditor`
and Email Studio both wrap theirs. Adding a link saved and navigated away from
the template; in Email Studio it would have sent the message. Covered by
RichTextEditor.test.tsx's "inside a page form" block.

## Link and button URLs are normalized, not validated away

(`url.ts`.) People type `example.com`; stored verbatim that is a *relative* URL,
which in a mail client resolves against nothing. Those fields are deliberately
not `type="url"` — the browser would reject a bare domain before the form ever
submitted. `{{variable}}` hrefs, anchors and root-relative paths pass through
untouched.

## `CtaButton` is an inline atom, not a block

A block node can only ever occupy its own line, so it could never sit beside
text. Placement is therefore the *paragraph's* `text-align` (owned by the
TextAlign extension), not a button attribute — the dialog's alignment control
writes to the line, and only when the user changes it.

Three further traps live in `button-extension.ts`, all with regression tests:

- Its parse rule needs a high **rule** `priority` to beat Link. Extension
  priority would also reorder the schema and make this content-less atom the
  default block type, breaking lists and Enter.
- `font-weight` must stay off the anchor and on the inner label span, or Bold
  parses it back as a mark and wraps the button in `<strong>` on every reopen.
- Colours are hex-validated before reaching an inline `style`.
