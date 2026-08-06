import * as React from "react";
import { cn } from "@/lib/utils";
import {
  fieldBase,
  fieldControlHeight,
  fieldWidths,
  type FieldWidth
} from "./field.js";

export interface InputProps extends React.ComponentProps<"input"> {
  /**
   * Width by content type — see `fieldWidths`. Defaults to `full`, which is
   * what every existing call site currently gets implicitly; pages set a real
   * width as they migrate.
   */
  width?: FieldWidth;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, width = "full", ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          fieldBase,
          fieldControlHeight,
          fieldWidths[width],
          // `search` renders a UA clear button that collides with our own
          // padding in WebKit.
          "[&::-webkit-search-cancel-button]:appearance-none",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
