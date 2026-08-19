import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  Send,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { PageContainer } from "../components/PageContainer.js";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { api, type SentEmail, type SentEmailOutcome } from "../lib/api.js";
import { formatFullDate, formatTimestamp } from "../lib/format.js";
import { qk } from "../lib/query-client.js";
import {
  ORIGIN_LABEL,
  engagementLabel,
  outcomeOf,
} from "../lib/sent-email.js";
import { useOrgQuery } from "../lib/use-api.js";
import { useSession } from "../lib/session-context.js";
import { cn } from "../lib/utils.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { DataGrid } from "../components/ui/data-grid.js";
import { IconButton } from "../components/ui/icon-button.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import { Hint } from "../components/ui/tooltip.js";

/*
  The sent archive is the one list in this app that pages on the server, so a
  page size is a real request parameter rather than a grid setting. 25 is what
  fits a laptop screen without the header leaving the viewport.
*/
const PAGE_SIZE = 25;

// Radix Select has no concept of an empty value, so "no filter" needs a token
// of its own rather than "".
const ALL = "all";

type OriginFilter = "all" | "CAMPAIGN" | "TRANSACTIONAL" | "MANUAL" | "SYSTEM";

/*
  The archive opens on the mail you wrote yourself.

  "All types" is the honest default and the wrong one: one campaign to a
  10,000-address list puts 10,000 rows in front of someone looking for the
  message they sent a customer on Tuesday, and no amount of paging gets them
  past it. Campaign sends are already answerable as a cohort, from the
  campaign's own analytics — this list is the one place a single message is
  findable, so it leads with the ones a person actually wrote.

  Switching to "All types" is one select away and, like every other filter here,
  it goes in the URL — so the wider view is bookmarkable for anyone who wants it
  as their normal.
*/
const DEFAULT_ORIGIN: OriginFilter = "MANUAL";

const ORIGIN_OPTIONS: { value: OriginFilter; label: string }[] = [
  { value: ALL, label: "All types" },
  { value: "MANUAL", label: ORIGIN_LABEL.MANUAL },
  { value: "CAMPAIGN", label: ORIGIN_LABEL.CAMPAIGN },
  { value: "TRANSACTIONAL", label: ORIGIN_LABEL.TRANSACTIONAL },
  { value: "SYSTEM", label: ORIGIN_LABEL.SYSTEM },
];

const OUTCOME_OPTIONS: { value: SentEmailOutcome; label: string }[] = [
  { value: ALL, label: "Any outcome" },
  { value: "delivered", label: "Delivered" },
  { value: "opened", label: "Opened" },
  { value: "clicked", label: "Clicked" },
  { value: "bounced", label: "Bounced" },
  { value: "complained", label: "Marked as spam" },
  { value: "failed", label: "Failed to send" },
];

const WINDOW_OPTIONS: { value: string; label: string }[] = [
  { value: "0", label: "Any time" },
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

function describeRecipients(email: SentEmail) {
  const extra = email.ccCount + email.bccCount;
  const shown = email.to.slice(0, 2).join(", ") || "—";
  const hidden = Math.max(email.to.length - 2, 0);
  const more = hidden + extra;
  return more > 0 ? `${shown} +${more} more` : shown;
}

/**
 * Sent — everything that has already gone out.
 *
 * The mirror of the Outbox, and the only list in the app that filters, sorts
 * and pages **on the server**: an org that sends a campaign a week accumulates
 * six figures of rows here, so the browser never holds more than one page. That
 * has one visible consequence — the column headers don't sort. Sorting 25 of
 * 40,000 rows would look like it worked and quietly lie, so the archive keeps
 * one order (newest first) and gives you filters instead.
 */
export function Sent() {
  const { currentOrganizationId: organizationId } = useSession();
  const navigate = useNavigate();

  /*
    The filters live in the query string, not in component state.

    Opening a message is a navigation now, and React Router restores no state on
    the way back — so with the filters held in `useState`, coming out of a
    message dropped you on page 1 of the unfiltered archive, having lost the
    search that found it. In the URL they survive the round trip for free, and
    the page someone found something on becomes a link they can send.
  */
  const [params, setParams] = useSearchParams();
  const search = params.get("q")?.trim() ?? "";
  const outcome = (params.get("outcome") as SentEmailOutcome) ?? ALL;
  const origin = (params.get("origin") as OriginFilter) ?? DEFAULT_ORIGIN;
  const accountId = params.get("account") ?? ALL;
  const days = params.get("days") ?? "0";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);

  // The search box is typed into, so it keeps local state and syncs to the URL
  // on a debounce; the selects write straight through.
  const [searchInput, setSearchInput] = useState(search);
  // The selects are always on screen from `sm` up; on a phone they fold behind
  // this so the list itself isn't pushed off the bottom of the viewport.
  const [filtersOpen, setFiltersOpen] = useState(false);

  /**
   * Write one filter into the URL.
   *
   * Takes the updater form of `setParams` rather than reading `params`, so it
   * closes over nothing that changes and stays stable across renders — the
   * debounce below depends on it and would otherwise re-arm on every unrelated
   * filter change. `replace` so a filter change doesn't stack a history entry
   * per keystroke: back should leave the archive, not walk backwards through
   * everything you tried in it.
   */
  const setParam = useCallback(
    (next: Record<string, string | null>) => {
      setParams(
        (current) => {
          const updated = new URLSearchParams(current);
          for (const [key, value] of Object.entries(next)) {
            if (value === null || value === "") updated.delete(key);
            else updated.set(key, value);
          }
          return updated;
        },
        { replace: true }
      );
    },
    [setParams]
  );

  // Every keystroke would otherwise be a query against the biggest table the
  // org has. 300ms is below the threshold where typing feels laggy.
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === search) return;
    const timer = window.setTimeout(() => {
      setParam({ q: trimmed || null, page: null });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput, search, setParam]);

  const filters = useMemo(
    () => ({
      q: search || undefined,
      origin,
      outcome,
      smtpConnectionId: accountId === ALL ? undefined : accountId,
      days: Number(days),
      page,
    }),
    [search, origin, outcome, accountId, days, page]
  );

  const sentQuery = useOrgQuery(
    organizationId,
    qk.sent(organizationId ?? "", filters),
    (id) =>
      api.listSentEmails({
        organizationId: id,
        ...filters,
        pageSize: PAGE_SIZE,
      }),
    {
      // Paging and filtering swap the query key, and a skeleton on every
      // keystroke is the flicker §6 rules out. Hold the previous page until the
      // next one lands.
      placeholderData: keepPreviousData,
    }
  );

  // Names the "Sent from" filter. The UI says sending accounts; the API says
  // SMTP connections.
  const accountsQuery = useOrgQuery(
    organizationId,
    qk.smtpConnections(organizationId ?? ""),
    (id) => api.listSMTPConnections(id)
  );

  const rows = sentQuery.data?.rows ?? [];
  const total = sentQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const accounts = accountsQuery.data ?? [];

  const activeFilters =
    (search ? 1 : 0) +
    (outcome === ALL ? 0 : 1) +
    // Counted against the default, which is MANUAL — the type select is never
    // "off", so what makes it *active* is departing from where it starts.
    (origin === DEFAULT_ORIGIN ? 0 : 1) +
    (accountId === ALL ? 0 : 1) +
    (days === "0" ? 0 : 1);

  function clearFilters() {
    setSearchInput("");
    setParams(new URLSearchParams(), { replace: true });
  }

  /** Every filter change resets to page 1 — page 7 of the old result set is a
      different set of emails, and landing on an empty page reads as a bug. */
  function onFilterChange(key: string) {
    return (value: string) => {
      // Clear the parameter when the choice *is* the default, rather than
      // writing a redundant one. For `origin` the default is MANUAL, not "all",
      // so "All types" is a value the URL has to carry explicitly.
      const cleared =
        key === "origin"
          ? value === DEFAULT_ORIGIN
          : value === ALL || (key === "days" && value === "0");
      setParam({ [key]: cleared ? null : value, page: null });
    };
  }

  /*
    Four columns, and no "Sent from" among them — deliberately.

    A 1024px laptop leaves the table 736px once the sidebar and page padding
    have taken theirs, and five columns of mail-shaped text do not fit in that
    without a sideways scrollbar (§7 forbids one at any width). The account is
    the one of the five that repeats itself down the page — most orgs send from
    one or two — so it earns its keep as a *filter* and a line in the row's
    detail dialog rather than as a column that says the same thing 25 times.
  */
  const columns = useMemo<ColumnDef<SentEmail, unknown>[]>(
    () => [
      {
        accessorKey: "subject",
        header: "Email",
        meta: { title: "Email" },
        // Sorting is off on every column: the grid only holds the current page,
        // so a sort would reorder 25 rows out of however many matched and
        // present it as the order of the whole archive.
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-0 max-w-cell-lg">
            <div className="truncate font-medium">
              {row.original.subject || "(no subject)"}
            </div>
            <div className="mt-1 flex items-center gap-field">
              <Badge variant="secondary" className="font-normal">
                {ORIGIN_LABEL[row.original.origin]}
              </Badge>
              {row.original.campaignName ? (
                <span className="truncate text-meta text-text-tertiary">
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
        /*
          `max-w-0` with a percentage width, rather than a fixed cap on the
          text inside.

          An email address is one unbreakable token, so a `truncate` span with
          no bound reports the whole address as its minimum width and pushes the
          table past the 736px a 1024px laptop leaves it — that is what put a
          horizontal scrollbar on this page the first time. A fixed cap fixes
          that but then truncates at the same 160px on a 1280px screen with room
          to spare beside it. Zeroing the cell's max-width makes the percentage
          the width the browser resolves against instead, so the address uses
          whatever the viewport actually has and ellipsises at exactly that.
        */
        meta: {
          title: "To",
          hideBelowMd: true,
          cellClassName: "w-1/4 max-w-0",
          headerClassName: "w-1/4 max-w-0",
        },
        enableSorting: false,
        cell: ({ row }) => (
          // The full list is still a hover away here, and a click away in the
          // row's detail dialog.
          <Hint label={row.original.to.join(", ") || "No recipients"}>
            <span className="block cursor-help truncate">
              {describeRecipients(row.original)}
            </span>
          </Hint>
        ),
      },
      {
        id: "outcome",
        header: "Outcome",
        meta: { title: "Outcome" },
        enableSorting: false,
        cell: ({ row }) => {
          const outcomeBadge = outcomeOf(row.original);
          const engagement = engagementLabel(row.original);
          return (
            <div className="flex flex-col items-start gap-1">
              <Badge
                variant={outcomeBadge.variant}
                className="whitespace-nowrap"
              >
                {outcomeBadge.label}
              </Badge>
              {engagement ? (
                <span
                  className="whitespace-nowrap text-meta text-text-tertiary"
                  data-numeric
                >
                  {engagement}
                </span>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "sentAt",
        header: "Sent",
        meta: { title: "Sent", align: "right" },
        enableSorting: false,
        cell: ({ row }) => (
          <Hint
            label={formatFullDate(
              row.original.sentAt ?? row.original.createdAt
            )}
          >
            {/* nowrap: a wrapped "Aug 7, 10:18 AM" is three ragged lines, and
                a column of dates that don't line up is unreadable. */}
            <time
              dateTime={row.original.sentAt ?? row.original.createdAt}
              className="cursor-help whitespace-nowrap"
            >
              {formatTimestamp(row.original.sentAt ?? row.original.createdAt)}
            </time>
          </Hint>
        ),
      },
    ],
    []
  );

  const emptyState =
    activeFilters > 0 ? (
      <EmptyState
        icon={Send}
        title="No emails match these filters"
        // No button of its own: "Clear filters" is already sitting in the
        // toolbar directly above this, and two identical controls one under the
        // other is a choice where there isn't one.
        description="Widen the date range or clear a filter to see more of the archive."
      />
    ) : (
      /*
        The unfiltered-looking view is still filtered — it is the MANUAL default
        — so "Nothing sent yet" would be a lie to an org whose mail is all
        campaigns or all API sends. It says what is missing and points at the
        select that widens it.
      */
      <EmptyState
        icon={Send}
        title="Nothing written by you yet"
        description="This shows the emails you composed. Campaign batches and sends from the API are here too — switch Type to see them."
        action={
          <Button
            type="button"
            variant="outline"
            onClick={() => onFilterChange("origin")(ALL)}
          >
            Show every type
          </Button>
        }
      />
    );

  return (
    <>
      <PageHeader
        title="Sent"
        description="Every email that has already gone out, with what happened to it after it left. Search the archive or narrow it by outcome, type, account, and date."
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => void sentQuery.refetch()}
            disabled={!organizationId || sentQuery.isFetching}
          >
            <RefreshCw
              className={sentQuery.isFetching ? "animate-spin" : undefined}
            />
            Refresh
          </Button>
        }
      />

      <PageContainer className="flex flex-col gap-4">
        {/* --------------------------------------------------------- table */}
        {/*
          The grid's own search and pagination are off: both work over the rows
          it was handed, and it is only ever handed the page the server sent.
          The filters go in its `toolbar` slot rather than above it so they
          share a row with the column-visibility menu — parked on its own
          otherwise, which reads as a control that lost its toolbar.
        */}
        <DataGrid
          label="Sent emails"
          data={rows}
          columns={columns}
          getRowId={(row) => row.id}
          loading={sentQuery.isPending}
          searchable={false}
          paginated={false}
          onRowClick={(email) => navigate(`/sent/${email.id}`)}
          getRowLabel={(row) => `Open ${row.subject || "(no subject)"}`}
          empty={emptyState}
          toolbar={
            <div className="flex flex-1 flex-col gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-field">
                  <Label htmlFor="sent-search">Search</Label>
                  <div className="relative w-full xs:w-field-search">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
                      aria-hidden
                    />
                    <Input
                      id="sent-search"
                      // Most of what gets typed here is an address or an ID, and
                      // autocorrect on a phone rewrites those into nothing.
                      identifier
                      type="search"
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.target.value)}
                      placeholder="Subject, address, campaign…"
                      className="pl-control pr-control"
                    />
                    {searchInput ? (
                      <IconButton
                        label="Clear search"
                        size="sm"
                        onClick={() => setSearchInput("")}
                        className="absolute right-1 top-1/2 -translate-y-1/2"
                      >
                        <X />
                      </IconButton>
                    ) : null}
                  </div>
                </div>

                {/* The phone's disclosure for the four selects below. Never shown
                from `sm` up, where they all fit on one row anyway. */}
                <Button
                  type="button"
                  variant="outline"
                  className="sm:hidden"
                  aria-expanded={filtersOpen}
                  aria-controls="sent-filters"
                  onClick={() => setFiltersOpen((open) => !open)}
                >
                  <SlidersHorizontal />
                  Filters
                  {activeFilters > 0 ? (
                    <span className="text-text-tertiary" data-numeric>
                      {activeFilters}
                    </span>
                  ) : null}
                </Button>

                {/*
              Deliberately outside the disclosure below. It is the way out of a
              filter that matched nothing, so it has to be reachable without
              first opening the thing that got you there — and keeping it here
              means the "no matches" empty state doesn't need a second copy of
              the same button a few pixels under it.
            */}
                {activeFilters > 0 ? (
                  <Button type="button" variant="ghost" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : null}
              </div>

              <div
                id="sent-filters"
                className={cn(
                  "flex-wrap items-end gap-3",
                  filtersOpen ? "flex" : "hidden sm:flex"
                )}
              >
                <div className="flex flex-col gap-field">
                  <Label htmlFor="sent-outcome">Outcome</Label>
                  <Select value={outcome} onValueChange={onFilterChange("outcome")}>
                    <SelectTrigger id="sent-outcome" width="choice">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OUTCOME_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-field">
                  <Label htmlFor="sent-type">Type</Label>
                  <Select value={origin} onValueChange={onFilterChange("origin")}>
                    <SelectTrigger id="sent-type" width="choice">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ORIGIN_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-field">
                  <Label htmlFor="sent-account">Sent from</Label>
                  <Select value={accountId} onValueChange={onFilterChange("account")}>
                    <SelectTrigger id="sent-account" width="choice">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All accounts</SelectItem>
                      {accounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-field">
                  <Label htmlFor="sent-window">When</Label>
                  <Select value={days} onValueChange={onFilterChange("days")}>
                    <SelectTrigger id="sent-window" width="choice">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WINDOW_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          }
          renderMobileRow={(email) => {
            const outcomeBadge = outcomeOf(email);
            const engagement = engagementLabel(email);
            return (
              <div className="flex flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-body font-medium text-text">
                    {email.subject || "(no subject)"}
                  </span>
                  <Badge variant={outcomeBadge.variant} className="shrink-0">
                    {outcomeBadge.label}
                  </Badge>
                </div>
                <p className="truncate text-ui text-text-secondary">
                  {describeRecipients(email)}
                </p>
                <div className="flex items-center justify-between gap-2">
                  {/* Type and engagement on one line: the badge above says what
                      happened, this says how much of it and to which kind of
                      mail. Truncates rather than wrapping to a fourth line. */}
                  <span className="min-w-0 truncate text-meta text-text-tertiary">
                    {engagement
                      ? `${ORIGIN_LABEL[email.origin]} · ${engagement}`
                      : ORIGIN_LABEL[email.origin]}
                  </span>
                  <span
                    className="shrink-0 text-meta text-text-tertiary"
                    data-numeric
                  >
                    {formatTimestamp(email.sentAt ?? email.createdAt)}
                  </span>
                </div>
              </div>
            );
          }}
        />

        {/* ---------------------------------------------------------- pager */}
        {/*
          The grid's pager counts the rows it holds; this one counts what the
          server matched, which is the number that means something here.
        */}
        {!sentQuery.isPending && total > 0 ? (
          <div className="flex items-center justify-between gap-2 text-ui text-text-secondary">
            <span data-numeric>
              Page {page} of {pageCount} · {total.toLocaleString()}{" "}
              {total === 1 ? "email" : "emails"}
            </span>
            <div className="flex items-center gap-1">
              <IconButton
                label="Previous page"
                variant="outline"
                onClick={() => setParam({ page: String(Math.max(1, page - 1)) })}
                disabled={page <= 1}
              >
                <ChevronLeft />
              </IconButton>
              <IconButton
                label="Next page"
                variant="outline"
                onClick={() =>
                  setParam({ page: String(Math.min(pageCount, page + 1)) })
                }
                disabled={page >= pageCount}
              >
                <ChevronRight />
              </IconButton>
            </div>
          </div>
        ) : null}
      </PageContainer>
    </>
  );
}
