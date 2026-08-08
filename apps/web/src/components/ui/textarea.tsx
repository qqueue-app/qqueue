import * as React from "react";
import { cn } from "@/lib/utils";
import { fieldBase } from "./field.js";

/*
  A textarea is the one control that legitimately fills the form column — the
  anti-stretch rule is about short, known-length values, and prose has no
  natural width short of the measure. It gets vertical padding instead of a
  fixed height.
*/
const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(fieldBase, "min-h-textarea py-2 leading-6", className)}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
