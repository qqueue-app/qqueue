import { Paperclip } from "lucide-react";
import { cn } from "../../lib/utils.js";

/** Shared horizontal desktop scan line and stacked phone presentation. */
export function MailRow({
  sender,
  subject,
  preview,
  unread,
  count,
  attachment,
  status,
}: {
  sender: string;
  subject: string;
  preview: string;
  unread?: boolean;
  count?: number;
  attachment?: boolean;
  status?: string;
}) {
  return (
    <span className={cn("mail-row-content", unread && "is-unread")}>
      <span className={cn("mail-row-sender", unread && "font-semibold")}>
        {sender}
        {count && count > 1 ? (
          <span className="ml-1 font-normal text-text-secondary">
            ({count})
          </span>
        ) : null}
      </span>
      <span className="mail-row-copy">
        <span className={cn("mail-row-subject", unread && "font-semibold")}>
          {subject || "(no subject)"}
        </span>
        {preview ? (
          <span className="mail-row-preview">
            <span className="mail-preview-separator" aria-hidden>
              {" "}
              —{" "}
            </span>
            {preview}
          </span>
        ) : null}
      </span>
      {status ? <span className="mail-row-status">{status}</span> : null}
      {attachment ? (
        <Paperclip
          aria-label="Has attachments"
          className="h-4 w-4 shrink-0 text-text-secondary"
        />
      ) : null}
    </span>
  );
}
