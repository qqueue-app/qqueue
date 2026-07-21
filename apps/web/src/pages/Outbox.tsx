import { useCallback, useEffect, useState } from "react";
import { MailCheck, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { api, type OutboxEmail } from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card } from "../components/ui/card.js";
import { Skeleton } from "../components/ui/skeleton.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../components/ui/table.js";

// Only mail that has not been handed to SMTP yet can be pulled back.
const CANCELLABLE = new Set(["PENDING", "QUEUED"]);

const ORIGIN_LABEL: Record<OutboxEmail["origin"], string> = {
  MANUAL: "Written by you",
  CAMPAIGN: "Campaign",
  TRANSACTIONAL: "App or API"
};

function formatWhen(email: OutboxEmail) {
  if (email.status === "PROCESSING") {
    return "Sending now";
  }
  if (!email.scheduledAt) {
    return "As soon as possible";
  }
  const date = new Date(email.scheduledAt);
  if (Number.isNaN(date.getTime())) {
    return "Scheduled";
  }
  return date.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit"
  });
}

function describeRecipients(email: OutboxEmail) {
  const extra = email.ccCount + email.bccCount;
  const shown = email.to.slice(0, 2).join(", ") || "—";
  const hidden = email.to.length - 2;
  const more = (hidden > 0 ? hidden : 0) + extra;
  return more > 0 ? `${shown} +${more} more` : shown;
}

export function Outbox() {
  const { currentOrganizationId: organizationId } = useSession();
  const [emails, setEmails] = useState<OutboxEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState<OutboxEmail | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(
    async (showSpinner = true) => {
      if (!organizationId) {
        setLoading(false);
        return;
      }
      if (showSpinner) {
        setLoading(true);
      }
      try {
        setEmails(await api.listOutbox(organizationId));
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Couldn't load what's waiting to send."
        );
      } finally {
        setLoading(false);
      }
    },
    [organizationId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmCancel() {
    if (!cancelTarget || !organizationId) {
      return;
    }
    setCancelling(true);
    try {
      await api.cancelOutboxEmail(cancelTarget.id, organizationId);
      setEmails((current) =>
        current.filter((email) => email.id !== cancelTarget.id)
      );
      setCancelTarget(null);
      toast.success("Cancelled — that email won't be sent.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't cancel that email."
      );
      // The list is the source of truth about what is still cancellable, and a
      // failure usually means it just went out.
      await load(false);
    } finally {
      setCancelling(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Outbox"
        description="Emails that are waiting to go out — scheduled sends, campaign batches, and anything the app is still working through."
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => void load()}
            disabled={!organizationId}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        }
      />

      <section className="p-5 sm:p-6">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : emails.length === 0 ? (
          <Card className="p-2">
            <EmptyState
              icon={MailCheck}
              title="Nothing waiting to send"
              description="Scheduled emails and campaigns that haven't gone out yet will show up here, and you can cancel them from this page."
            />
          </Card>
        ) : (
          <Card className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Sending from</TableHead>
                  <TableHead>Goes out</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {emails.map((email) => (
                  <TableRow key={email.id}>
                    <TableCell>
                      <div className="max-w-xs truncate font-medium">
                        {email.subject || "(no subject)"}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <Badge variant="secondary" className="font-normal">
                          {ORIGIN_LABEL[email.origin]}
                        </Badge>
                        {email.campaignName ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {email.campaignName}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[16rem] truncate">
                      {describeRecipients(email)}
                    </TableCell>
                    <TableCell>
                      {email.sendingAccount ? (
                        <>
                          <div className="truncate">
                            {email.sendingAccount.fromName
                              ? `${email.sendingAccount.fromName} <${email.sendingAccount.fromEmail}>`
                              : email.sendingAccount.fromEmail}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {email.sendingAccount.name}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">
                          Account removed
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{formatWhen(email)}</TableCell>
                    <TableCell>
                      {CANCELLABLE.has(email.status) ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setCancelTarget(email)}
                        >
                          <X className="h-4 w-4" />
                          Cancel
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Too late to cancel
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        title="Cancel this email?"
        description={
          cancelTarget
            ? `"${cancelTarget.subject || "(no subject)"}" won't be sent. This can't be undone.`
            : ""
        }
        confirmLabel="Cancel email"
        loading={cancelling}
        onConfirm={confirmCancel}
      />
    </>
  );
}
