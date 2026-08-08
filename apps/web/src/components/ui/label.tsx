import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/utils";

/**
 * Field label — 13px/500 in primary text. Sits above its field with 6px of air;
 * helper text goes *below* the field, never beside it.
 */
const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      "text-ui font-medium leading-none text-text",
      "peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
      className
    )}
    {...props}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;

/** Helper text under a field. */
const FieldHint = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-meta text-text-tertiary", className)} {...props} />
));
FieldHint.displayName = "FieldHint";

/**
 * Inline validation message. Rendered below the field in --err-text, and always
 * paired with `aria-invalid` + `aria-describedby` on the control — a toast is
 * not a substitute, because it is gone before the user reaches the field.
 */
const FieldError = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    role="alert"
    className={cn("text-meta text-err", className)}
    {...props}
  />
));
FieldError.displayName = "FieldError";

/**
 * ALL-CAPS eyebrow, for sidebar section headings and the like.
 */
const Eyebrow = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "text-meta font-medium uppercase tracking-eyebrow text-text-tertiary",
      className
    )}
    {...props}
  />
));
Eyebrow.displayName = "Eyebrow";

export { Label, FieldHint, FieldError, Eyebrow };
