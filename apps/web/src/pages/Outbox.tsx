import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { MailCheck, RefreshCw, X } from "lucide-react";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { api, type OutboxEmail } from "../lib/api.js";
import { formatFullDate } from "../lib/format.js";
import { qk } from "../lib/query-client.js";
import { useApiMutation, useOrgQuery } from "../lib/use-api.js";
import { useSession } from "../lib/session-context.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { DataGrid } from "../components/ui/data-grid.js";
import { RowActions } from "../components/ui/row-actions.js";
import { Hint } from "../components/ui/tooltip.js";

// Only mail that has not been handed to SMTP yet can be pulled back.
const CANCELLABLE = new Set(["PENDING", "QUEUED"]);

const ORIGIN_LABEL: Record<OutboxEmail["origin"], string> = {
  MANUAL: "Written by you",
  CAMPAIGN: "Campaign",
  TRANSACTIONAL: "App or API",
  SYSTEM: "Account email",
};

function whenLabel(email: OutboxEmail) {
  if (email.status === "PROCESSING") return "Sending now";
  if (!email.scheduledAt) return "As soon as possible";
  const date = new Date(email.scheduledAt);
  if (Number.isNaN(date.getTime())) return "Scheduled";
  return date.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Sort key for "goes out": unscheduled mail leaves first, so it sorts first. */
function whenValue(email: OutboxEmail) {
  return email.scheduledAt ? new Date(email.scheduledAt).getTime() : 0;
}

function describeRecipients(email: OutboxEmail) {
  const extra = email.ccCount + email.bccCount;
  const shown = email.to.slice(0, 2).join(", ") || "—";
  const hidden = Math.max(email.to.length - 2, 0);
  const more = hidden + extra;
  return more > 0 ? `${shown} +${more} more` : shown;
}

function sendingAccountLabel(email: OutboxEmail) {
  if (!email.sendingAccount) return "Account removed";
  return email.sendingAccount.fromName
    ? `${email.sendingAccount.fromName} <${email.sendingAccount.fromEmail}>`
    : email.sendingAccount.fromEmail;
}

/**
 * Outbox — mail that has been accepted but hasn't left yet, and the one place
 * to pull something back before it does.
 */
export function Outbox() {
  const { currentOrganizationId: organizationId } = useSession();
  const [cancelTarget, setCancelTarget] = useState<OutboxEmail | null>(null);

  const outboxQuery = useOrgQuery(
    organizationId,
    qk.outbox(organizationId ?? ""),
    (id) => api.listOutbox(id),
    {
      // The queue drains on its own; a stale outbox invites someone to try
      // cancelling mail that already went.
      refetchInterval: 30_000,
    }
  );

  const cancel = useApiMutation(
    (email: OutboxEmail) =>
      api.cancelOutboxEmail(email.id, organizationId as string),
    {
      successMessage: "Cancelled — that email won't be sent.",
      errorMessage: "Couldn't cancel that email.",
      invalidates: [qk.outbox(organizationId ?? "")],
      onSuccess: () => setCancelTarget(null),
      onError: () => {
        setCancelTarget(null);
        // A failure here almost always means the email just went out. Refresh
        // so the row shows its real state instead of still offering a Cancel
        // button that can never work.
        void outboxQuery.refetch();
      },
    }
  );

  const columns = useMemo<ColumnDef<OutboxEmail, unknown>[]>(
    () => [
      {
        accessorKey: "subject",
        header: "Email",
        meta: { title: "Email" },
        cell: ({ row }) => (
          <div className="min-w-0 max-w-sm">
            <div className="truncate font-medium">
              {row.original.subject || "(no subject)"}
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <Badge variant="secondary" className="font-normal">
                {ORIGIN_LABEL[row.original.origin]}
              </Badge>
              {row.original.campaignName ? (
                <span className="truncate text-xs text-muted-foreground">
                  {row.original.campaignName}
                </span>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        id: "to",
        accessorFn: (row) => row.to.join(", "),
        header: "To",
        meta: { title: "To", hideBelowMd: true },
        cell: ({ row }) => (
          <Hint label={row.original.to.join(", ") || "No recipients"}>
            <span className="block max-w-[16rem] cursor-help truncate">
              {describeRecipients(row.original)}
            </span>
          </Hint>
        ),
      },
      {
        id: "from",
        accessorFn: sendingAccountLabel,
        header: "Sending from",
        meta: { title: "Sending from", hideBelowLg: true },
        cell: ({ row }) =>
          row.original.sendingAccount ? (
            <div className="min-w-0">
              <div className="truncate">
                {sendingAccountLabel(row.original)}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {row.original.sendingAccount.name}
              </div>
            </div>
          ) : (
            <span className="text-muted-foreground">Account removed</span>
          ),
      },
      {
        id: "when",
        accessorFn: whenValue,
        header: "Goes out",
        meta: { title: "Goes out" },
        cell: ({ row }) =>
          row.original.scheduledAt ? (
            <Hint label={formatFullDate(row.original.scheduledAt)}>
              <span className="cursor-help">{whenLabel(row.original)}</span>
            </Hint>
          ) : (
            <span>{whenLabel(row.original)}</span>
          ),
      },
      {
        id: "actions",
        header: "",
        meta: { pinned: true, align: "right" },
        enableSorting: false,
        cell: ({ row }) =>
          CANCELLABLE.has(row.original.status) ? (
            <RowActions
              rowLabel={row.original.subject || "this email"}
              actions={[
                {
                  label: "Cancel this email",
                  icon: X,
                  primary: true,
                  destructive: true,
                  onSelect: () => setCancelTarget(row.original),
                },
              ]}
            />
          ) : (
            <Hint label="This email has already been handed to the mail server, so it can't be pulled back.">
              <span className="cursor-help text-xs text-muted-foreground">
                Too late
              </span>
            </Hint>
          ),
      },
    ],
    []
  );

  return (
    <>
      <PageHeader
        title="Outbox"
        description="Emails waiting to go out — scheduled sends, campaign batches, and anything still being worked through. Cancel one here before it leaves."
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => void outboxQuery.refetch()}
            disabled={!organizationId || outboxQuery.isFetching}
          >
            <RefreshCw
              className={outboxQuery.isFetching ? "animate-spin" : undefined}
            />
            Refresh
          </Button>
        }
      />

      <section className="p-4 sm:p-6">
        <DataGrid
          label="Outbox"
          data={outboxQuery.data ?? []}
          columns={columns}
          getRowId={(row) => row.id}
          loading={outboxQuery.isPending}
          searchPlaceholder="Search waiting mail…"
          empty={
            <EmptyState
              icon={MailCheck}
              title="Nothing waiting to send"
              description="Scheduled emails and campaigns that haven't gone out yet show up here, and you can cancel them from this page."
            />
          }
          noResults={
            <EmptyState
              icon={MailCheck}
              title="No matching emails"
              description="Try a different search."
            />
          }
          renderMobileRow={(email) => (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {email.subject || "(no subject)"}
                </div>
                <div className="truncate text-sm text-muted-foreground">
                  {describeRecipients(email)}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary" className="font-normal">
                    {ORIGIN_LABEL[email.origin]}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {whenLabel(email)}
                  </span>
                </div>
              </div>
              {CANCELLABLE.has(email.status) ? (
                <RowActions
                  rowLabel={email.subject || "this email"}
                  actions={[
                    {
                      label: "Cancel this email",
                      icon: X,
                      primary: true,
                      destructive: true,
                      onSelect: () => setCancelTarget(email),
                    },
                  ]}
                />
              ) : null}
            </div>
          )}
        />
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
        loading={cancel.isPending}
        onConfirm={() => cancelTarget && cancel.mutate(cancelTarget)}
      />
    </>
  );
}
