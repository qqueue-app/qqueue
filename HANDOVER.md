# Handover — lossless rich text ↔ HTML in the composer

Branch: `feat/lossless-html-roundtrip`. Delete this file before merging.

## What this changes

`BodyEditor` used to refuse the rich text editor for markup the ProseMirror
schema couldn't hold. That was right about the loss (content with no node isn't
damaged on the way in — it is never stored at all) and wrong about the cost: one
`<style>` block meant no toolbar for the whole email, permanently.

The document is now **split rather than refused**:

- a complete document's `<head>`/scaffold is kept as two literal strings and put
  back around whatever the editor produces
- regions the schema can't represent become **raw blocks** holding their markup
  verbatim, framed in the editor with edit/remove controls
- everything else is ordinary editable content

Switching rich ↔ HTML is lossless in both directions, so the mode lock, the
"switch anyway, there is no way back" warning, and the tag/attribute allowlist
are all gone.

## The key idea (read this first)

`richTextCanRepresent` was a hand-maintained list of tags and attributes — a
second description of the schema that drifts from it the first time an extension
is added. It's replaced by **asking the schema directly**: parse the document
through it, serialize back, compare the two DOM trees. Whatever came back
different is frozen into a raw block, and the pass runs again on what's left.

`apps/web/src/components/editor/partition.ts` is the heart of it. Everything
else supports that loop.

Erring toward "different" is safe: a false difference costs editability (markup
preserved verbatim in a block), a false match costs the author's layout.

## New files

| File | Role |
| --- | --- |
| `partition.ts` | The round-trip loop. `partitionForSchema(html)` → `{ html, frozen }` |
| `dom-equivalence.ts` | `findDivergence` — tolerant of attr order, whitespace, CSSOM rewriting; strict about everything else |
| `document-model.ts` | `toEditorHtml` / `fromEditorHtml`, shell split/join |
| `html-dom.ts` | `<template>`-based parsing (won't relocate `<style>`), invented-paragraph handling |
| `raw-html-extension.ts` | The `rawHtml` atom + shadow-DOM node view. Base64 payload |
| `html-container-extension.ts` | Generic `div`/`section`/`center` wrappers, block + inline variants |
| `preserved-attributes.ts` | Carries `style`/`class`/`bgcolor`/`width`/… through the schema |
| `table-extension.ts` | Table nodes trimmed of scaffolding Tiptap adds (`<colgroup>`, `colspan="1"`, `min-width`) |
| `editor-extensions.ts` | The single extension list — editor and partitioner **must** share it |
| `RawBlockDialog.tsx` | Per-block source editing |

## Traps found the hard way (all have regression tests)

1. **Static `HTMLAttributes` vs attribute defaults.** Table/image styling was
   declared as static `HTMLAttributes`, which stamps it onto *every* node of
   that type on render — so a pasted `<table cellpadding="0">` came back
   carrying borders it never had, failed the round-trip, and got frozen. It's
   now a node attribute *default*, and `parseHTML` returns `""` (not `null`) so
   an absent attribute beats the default.
2. **…but only where there is a default to beat.** Returning `""` for an
   attribute another extension also declares (`title` on an image) makes that
   extension render it — the image came back with `title=""` it never had.
3. **`font-weight` in a style is parsed back as a Bold mark.** The header-cell
   default carried `font-weight:600`, so everything in a `<th>` came back
   wrapped in `<strong>` on every reopen. Removed — `<th>` is bold in every
   default stylesheet anyway. This is the same trap `CtaButton` documents.
4. **Rule priority, not extension priority** on `RawHtml`'s parse rule. Raising
   extension priority moves the node ahead of `paragraph` in the schema and
   makes a content-less atom the default block, breaking Enter and lists.
5. **Invented paragraphs.** `<td>Total</td>` parses to `<td><p>Total</p></td>`,
   a visible spacing change in a layout table. Paragraphs ProseMirror invents
   are flagged (`default: true` + `parseHTML: () => false` — reads backwards
   until you notice `parseHTML` only runs for paragraphs that were in the
   source) and unwrapped when they're their parent's only child.
6. **An empty body** would otherwise be frozen — a doc must hold one block, so
   ProseMirror supplies a paragraph the source didn't have. Special-cased.
7. **jsdom rewrites style attributes** (`#f4f4f5` → `rgb(244, 244, 245)`), so
   comparison runs both sides through the CSSOM.

## State

- `apps/web`: typecheck, lint, build all clean. **515/515 tests pass**
  (159 in `components/editor`, 19 of them new for raw blocks).
- Not yet run: `pnpm build`/`pnpm test` at the repo root for other packages.
  Nothing outside `apps/web/src/components/editor/` + `src/styles.css` was
  touched, so this is expected to be a formality.

### Pre-existing, not caused by this branch

- `@tiptap/extension-table` was in `apps/web/package.json` but not installed —
  the existing editor tests failed before I touched anything. Fixed with
  `pnpm install --filter @qqueue/web`. **Do this first on the new device.**
- `pnpm typecheck` fails in `@qqueue/worker`: `recurringSend`,
  `recurringSendRun`, `inboundAttachment` missing from the Prisma client. The
  models *are* in `core.prisma`, so the generated client is stale — `pnpm
  db:generate` should clear it. Unrelated to this work.

## Where I stopped

Mid-investigation of a React warning surfaced by the new test harness:

```
Cannot update a component (`Editor`) while rendering a different component (`RichTextEditor`)
```

It appears only in `raw-html-extension.test.tsx` → "renders a visible block's
markup in an isolated shadow root" (a `<font>` frozen inside an otherwise
editable table). Tests pass and nothing loops, but the question I was about to
answer is worth answering:

> **Does mounting a document containing a raw block fire `onChange` at mount?**

If it does, opening a template would immediately mark it dirty/unsaved — a real
UX bug, not just a warning. I had written a throwaway test rendering `BodyEditor`
against five documents (plain, style block, font-in-table, full document, email
layout) and counting `onChange` calls; deleted it rather than commit scratch
work. Recreate that, and if the count is non-zero at mount, the likely cause is
ProseMirror normalizing the doc on load and firing `onUpdate` — in which case
suppress the first emission when it is byte-identical to what was loaded.

## Also worth doing

- `CLAUDE.md` still documents the old behaviour: the `BodyEditor` bullet
  describing `richTextCanRepresent` and "such a body must open in the source
  view" is now wrong, as is the reference to the allowlists being checked in
  `RichTextEditor.test.tsx`. Not updated yet.
- Known ceiling: a document whose *top level* diverges (content appearing or
  disappearing outside any single element) falls back to one raw block for the
  whole body. Lossless, but not editable. Worth a look at whether that case can
  be narrowed.
