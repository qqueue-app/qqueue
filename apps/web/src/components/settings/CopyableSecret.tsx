import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert.js";
import { Button } from "../ui/button.js";

/**
 * A one-time secret — an API key, a webhook signing secret, an invite link —
 * shown once with a copy button.
 *
 * The value wraps rather than scrolling sideways. A `overflow-x: auto` box
 * would be a second scroll container (§2) and, worse, would hide the tail of
 * the one string on the page that has to be copied whole.
 */
export function CopyableSecret({
  title,
  description,
  value,
  copiedMessage,
  failureMessage,
}: {
  title: string;
  description?: string;
  value: string;
  copiedMessage: string;
  failureMessage: string;
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(copiedMessage);
    } catch {
      toast.error(failureMessage);
    }
  }

  return (
    <Alert variant="warning">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {description ? <p className="mt-1">{description}</p> : null}
        <div className="mt-2 flex flex-col gap-2 xs:flex-row xs:items-start">
          <code className="min-w-0 flex-1 break-all rounded-control bg-surface px-3 py-2 text-meta text-text">
            {value}
          </code>
          <Button
            type="button"
            variant="secondary"
            onClick={copy}
            className="shrink-0"
          >
            <Copy className="h-4 w-4" />
            Copy
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
