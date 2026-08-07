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
  /**
   * The value is an identifier, not prose: a hostname, a username, a token, a
   * tag, a search term.
   *
   * On a phone this is not a nicety. iOS capitalises the first letter of a
   * text field and runs autocorrect over it, which turns `smtp.gmail.com`
   * into `Smtp.gmail.com` and quietly mangles a username — a failed SMTP
   * connection whose cause is invisible in the form that produced it. Safari
   * exempts `type="email"` and `type="url"` from that treatment; every other
   * field has to opt out by hand, which is what this does.
   *
   * A prop rather than four attributes per call site, so the rule lives in one
   * place and a new field gets it by saying what it holds.
   */
  identifier?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, width = "full", identifier, ...props }, ref) => {
    return (
      <input
        type={type}
        // Spread last so a call site can still override any single one of
        // these — `identifier` sets the defaults, it doesn't seize the field.
        {...(identifier
          ? ({
              autoCapitalize: "none",
              autoCorrect: "off",
              spellCheck: false,
            } as const)
          : null)}
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
