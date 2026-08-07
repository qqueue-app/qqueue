import { cn } from "@/lib/utils";

/**
 * Shared field vocabulary for every text-entry control (input, textarea,
 * select trigger) so the three can never drift apart.
 */

/**
 * Field widths are set by **content type, not container**. This is the whole
 * width table in one place:
 *
 *   code    120px  port, short code, numeric count
 *   search  280px  search boxes
 *   name    360px  email address, person's name
 *   long    480px  subject line, URL, API key
 *   full    100%   textareas and rich editors, which do fill the form column
 *
 * Whitespace to the right of a field is correct, not wasted.
 *
 * **Mobile inversion:** below 480px every width collapses to 100%. The rule was
 * always "size to content", and on a phone the content column IS the width — a
 * 360px field in a 375px viewport is already content-sized.
 */
export const fieldWidths = {
  code: "w-full xs:w-field-code",
  search: "w-full xs:w-field-search",
  name: "w-full xs:w-field-name",
  long: "w-full xs:w-field-long",
  full: "w-full"
} as const;

export type FieldWidth = keyof typeof fieldWidths;

/**
 * Base styling shared by input, textarea and select trigger.
 *
 * The `text-base sm:text-body` pair is not a cosmetic choice: iOS Safari
 * auto-zooms the viewport when a focused field's text is under 16px, and this
 * app is installed to home screens. 16px on phones, 14px from the tablet
 * breakpoint up.
 */
export const fieldBase = cn(
  "flex w-full rounded-control border border-border-strong bg-surface",
  "px-3 text-base sm:text-body text-text",
  "transition-colors duration-fast ease-out",
  "placeholder:text-text-tertiary",
  "hover:border-text-tertiary",
  "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:opacity-60",
  // Paired with aria-invalid on the control, so the styling and the accessible
  // state can never disagree.
  "aria-[invalid=true]:border-err aria-[invalid=true]:hover:border-err"
);

/**
 * Height for single-line controls.
 *
 * 44px on a phone, 36px from the tablet breakpoint up. Buttons can keep their
 * 36px look and grow an invisible 44px hit area with a pseudo-element, but an
 * `<input>` is a void element — `::after` never renders on one — so the only
 * way a field can meet §5's touch minimum is to actually be that tall. The
 * density that matters is on the desktop, where it is unchanged.
 */
export const fieldControlHeight = "h-touch sm:h-control";
