import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import type { RecipientSuggestion } from "../../lib/api.js";
import { cn } from "../../lib/utils.js";
import { Field } from "../settings/FormLayout.js";
import { fieldWidths, type FieldWidth } from "../ui/field.js";
import { Label } from "../ui/label.js";
import { IconButton } from "../ui/icon-button.js";
import { Badge } from "../ui/badge.js";
const MAX_SUGGESTIONS = 8;
function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

interface RecipientFieldProps {
  id: string;
  label: string;
  emails: string[];
  onChange: (emails: string[]) => void;
  suggestions?: RecipientSuggestion[];
  /** Width by content type — see `fieldWidths`. Recipients are `long` (480px). */
  width?: FieldWidth;
  disabled?: boolean;
  pendingValue?: string;
  onPendingChange?: (value: string) => void;
}

// A chip input with autocomplete: type part of a name or address to pick from
// the contact book and previously-mailed addresses, or type a full address and
// press Enter/comma to add it. Used for the To/CC/BCC fields. Invalid or
// duplicate addresses are rejected on commit.
export function RecipientField({
  id,
  label,
  emails,
  onChange,
  suggestions = [],
  width = "long",
  disabled = false,
  pendingValue,
  onPendingChange,
}: RecipientFieldProps) {
  const [value, setValue] = useState(pendingValue ?? "");
  useEffect(() => {
    if (pendingValue !== undefined) setValue(pendingValue);
  }, [pendingValue]);
  function updateValue(next: string) {
    setValue(next);
    onPendingChange?.(next);
  }
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.setCustomValidity(
      value
        .split(/[,;\s]+/)
        .filter(Boolean)
        .some((part) => !isValidEmail(part))
        ? "Correct or remove the incomplete email address."
        : ""
    );
  }, [value]);
  const query = value.trim().toLowerCase();
  const matches = useMemo(() => {
    if (query === "") {
      return [];
    }
    const chosen = new Set(emails.map((email) => email.toLowerCase()));
    return suggestions
      .filter(
        (suggestion) =>
          !chosen.has(suggestion.email.toLowerCase()) &&
          (suggestion.email.toLowerCase().includes(query) ||
            (suggestion.name ?? "").toLowerCase().includes(query))
      )
      .slice(0, MAX_SUGGESTIONS);
  }, [suggestions, query, emails]);

  // Reset the highlight whenever the candidate set changes so a stale index
  // can't select the wrong person.
  useEffect(() => {
    setHighlight(0);
  }, [query]);

  function add(candidates: string[]) {
    const next = [...emails];
    const invalid: string[] = [];
    for (const candidate of candidates) {
      if (!isValidEmail(candidate)) {
        toast.error(`"${candidate}" is not a valid email address.`);
        invalid.push(candidate);
        continue;
      }
      if (
        next.some((email) => email.toLowerCase() === candidate.toLowerCase())
      ) {
        continue;
      }
      next.push(candidate);
    }
    onChange(next);
    updateValue(invalid.join(", "));
    inputRef.current?.setCustomValidity(
      invalid.length ? "Correct or remove the incomplete email address." : ""
    );
  }

  function commit(raw: string) {
    const parts = raw
      .split(/[,;\s]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) {
      return;
    }
    add(parts);
  }

  return (
    <Field className={fieldWidths[width]}>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        {/*
          Sized and styled like every other field — same border, same radius,
          same focus outline — but it grows downward as chips wrap instead of
          scrolling sideways. 44px tall on a phone, 36px from the tablet
          breakpoint up, matching `fieldControlHeight`.
        */}
        {/*
          Clicking anywhere in the box types into it. The text input is only
          28px tall inside a 44px box, so without this the padding around it is
          a dead zone on a phone — you tap the field, nothing focuses, and the
          keyboard never comes up. `onMouseDown` with the default prevented, so
          a tap on the padding doesn't blur-then-refocus and lose the caret.
        */}
        <div
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              event.preventDefault();
              inputRef.current?.focus();
            }
          }}
          className={cn(
            "flex min-h-touch w-full cursor-text flex-wrap items-center gap-field sm:min-h-control",
            "rounded-control border border-border-strong bg-surface px-2 py-field",
            "transition-colors duration-fast ease-out hover:border-text-tertiary",
            "focus-within:outline focus-within:outline-2 focus-within:outline-offset-2",
            "focus-within:outline-ring"
          )}
        >
          {emails.map((email) => (
            <Badge key={email} variant="neutral" className="gap-1 pr-1">
              {email}
              <IconButton
                type="button"
                disabled={disabled}
                label={`Remove ${email}`}
                onClick={() =>
                  onChange(emails.filter((current) => current !== email))
                }
                className={cn(
                  "relative flex h-4 w-4 items-center justify-center rounded-pill",
                  "text-text-tertiary transition-colors duration-fast ease-out hover:text-err",
                  // A 16px glyph is not a tap target. The chip keeps its size
                  // and grows an invisible 44px hit area on touch layouts only,
                  // the same trick <Button> and <IconButton> use.
                  "after:absolute after:left-1/2 after:top-1/2 after:h-touch after:w-touch",
                  "after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] sm:after:hidden"
                )}
              >
                <X className="h-3 w-3" />
              </IconButton>
            </Badge>
          ))}
          <input
            ref={inputRef}
            id={id}
            type="text"
            disabled={disabled}
            inputMode="email"
            value={value}
            autoComplete="off"
            role="combobox"
            aria-expanded={matches.length > 0}
            aria-controls={`${id}-suggestions`}
            onChange={(event) => {
              const next = event.target.value;
              updateValue(next);
              event.target.setCustomValidity(
                next
                  .split(/[,;\s]+/)
                  .filter(Boolean)
                  .some((part) => !isValidEmail(part))
                  ? "Correct or remove the incomplete email address."
                  : ""
              );
            }}
            onKeyDown={(event) => {
              if (matches.length > 0 && event.key === "ArrowDown") {
                event.preventDefault();
                setHighlight((current) => (current + 1) % matches.length);
              } else if (matches.length > 0 && event.key === "ArrowUp") {
                event.preventDefault();
                setHighlight(
                  (current) => (current - 1 + matches.length) % matches.length
                );
              } else if (event.key === "Escape" && matches.length > 0) {
                event.preventDefault();
                setHighlight(-1);
              } else if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                const match = matches[highlight];
                if (event.key === "Enter" && match) {
                  add([match.email]);
                } else {
                  commit(value);
                }
              } else if (
                event.key === "Backspace" &&
                value === "" &&
                emails.length > 0
              ) {
                onChange(emails.slice(0, -1));
              }
            }}
            onBlur={() => commit(value)}
            placeholder={emails.length === 0 ? "name@example.com" : ""}
            // 16px on a phone: anything smaller and iOS zooms the viewport the
            // moment this is focused, and the app is installed to home screens.
            className="min-w-[12ch] flex-1 bg-transparent px-1 py-1 text-base outline-none placeholder:text-text-tertiary sm:text-body"
          />
        </div>
        {matches.length > 0 ? (
          <ul
            id={`${id}-suggestions`}
            role="listbox"
            // scroll-exception: the recipient combobox's listbox — §2 names
            // comboboxes alongside dropdowns as the exception to the one-scroll
            // rule. It floats above the page and can't extend it.
            className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-dialog border border-border bg-popover p-1 shadow-overlay"
          >
            {matches.map((match, index) => (
              <li key={`${match.source}-${match.email}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === highlight}
                  // Commit on mousedown: the input's onBlur would otherwise fire
                  // first and swallow the click.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    add([match.email]);
                  }}
                  onMouseEnter={() => setHighlight(index)}
                  className={cn(
                    "flex min-h-touch w-full items-center gap-2 rounded-control px-2 py-field",
                    "text-left text-body sm:min-h-0",
                    index === highlight && "bg-accent"
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {match.name ? (
                      <>
                        {match.name}{" "}
                        <span className="text-text-secondary">
                          {match.email}
                        </span>
                      </>
                    ) : (
                      match.email
                    )}
                  </span>
                  {match.source === "recent" ? (
                    <span className="shrink-0 text-meta text-text-tertiary">
                      Recent
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Field>
  );
}
