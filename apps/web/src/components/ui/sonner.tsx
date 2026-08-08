import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Toasts: bottom-right, one line, short-lived. A toast is for confirming
 * something reversible ("Draft deleted · Undo") — never the only place an error
 * is reported, because it is gone before anyone can act on it.
 */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="light"
      position="bottom-right"
      duration={4000}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-surface group-[.toaster]:text-text group-[.toaster]:border group-[.toaster]:border-border group-[.toaster]:rounded-card group-[.toaster]:shadow-overlay",
          description: "group-[.toast]:text-text-secondary",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:rounded-control",
          cancelButton:
            "group-[.toast]:bg-surface-sunken group-[.toast]:text-text-secondary group-[.toast]:rounded-control",
          error: "group-[.toaster]:border-err/30",
          success: "group-[.toaster]:border-ok/30"
        }
      }}
      {...props}
    />
  );
}
