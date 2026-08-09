import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Globe,
  ListFilter,
  Loader2,
  Mail,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { cn } from "../lib/utils.js";
import { useIsMobile } from "../lib/use-media-query.js";
import { Avatar } from "./ui/avatar.js";
import { Badge } from "./ui/badge.js";
import { Input } from "./ui/input.js";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet.js";

export interface AccessPerson {
  id: string;
  name: string;
  email: string;
  /** Role as the UI says it, e.g. "Owner" — shown as a badge. */
  roleLabel: string;
  /**
   * People who hold the permission unconditionally: an owner or admin may send
   * as any of the organization's accounts. Their mailboxes are listed but not
   * togglable, because unticking one would do nothing.
   */
  alwaysAllowed?: boolean;
  alwaysAllowedReason?: string;
}

export interface AccessMailbox {
  /** The sending account's id — what a grant is actually attached to. */
  id: string;
  address: string;
  /** Display name of the mailbox, e.g. "Support". */
  label?: string | null;
  domain: string;
}

export interface SendAccessEditorProps {
  people: AccessPerson[];
  mailboxes: AccessMailbox[];
  /** True when `personId` currently holds a grant on `mailboxId`. */
  isGranted: (personId: string, mailboxId: string) => boolean;
  onToggle: (personId: string, mailboxId: string, next: boolean) => void;
  /** Grants mid-flight, keyed `${personId}:${mailboxId}`. */
  pending?: Set<string>;
  disabled?: boolean;
  noPeopleMessage?: string;
  noMailboxesMessage?: string;
}

/**
 * Who can send as what — as a person-first, two-pane editor.
 *
 * This replaced a people × mailboxes checkbox matrix. The matrix answered the
 * question in one glance, but only while both axes stayed small: a column per
 * sending account means an org with a dozen mailboxes scrolls sideways through
 * truncated addresses, and the header is the only thing telling you which
 * column you are ticking. Access is also read and edited one person at a time —
 * "what can this new hire send as" — which is a row, not a plane.
 *
 * So: pick a person on the left (searchable, because a member list is the one
 * axis that grows without bound), and their whole sending surface opens on the
 * right, grouped by domain. Domains are the grouping because that is how people
 * describe these addresses to each other — "everything on acme.test" — and it
 * turns a flat list of thirty addresses into four groups you can skim.
 */
export function SendAccessEditor({
  people,
  mailboxes,
  isGranted,
  onToggle,
  pending,
  disabled = false,
  noPeopleMessage = "Nobody to show yet.",
  noMailboxesMessage = "No sending accounts yet.",
}: SendAccessEditorProps) {
  const isMobile = useIsMobile();
  const [personQuery, setPersonQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Mailboxes arrive as a flat list of sending accounts; the domain groups are
  // derived here rather than asked of every caller.
  const groups = useMemo(() => {
    const byDomain = new Map<string, AccessMailbox[]>();
    for (const mailbox of mailboxes) {
      const existing = byDomain.get(mailbox.domain);
      if (existing) existing.push(mailbox);
      else byDomain.set(mailbox.domain, [mailbox]);
    }
    return [...byDomain.entries()]
      .map(([domain, items]) => ({
        domain,
        mailboxes: [...items].sort((a, b) => a.address.localeCompare(b.address)),
      }))
      .sort((a, b) => a.domain.localeCompare(b.domain));
  }, [mailboxes]);

  const visiblePeople = useMemo(() => {
    const query = personQuery.trim().toLowerCase();
    if (!query) return people;
    return people.filter(
      (person) =>
        person.name.toLowerCase().includes(query) ||
        person.email.toLowerCase().includes(query)
    );
  }, [people, personQuery]);

  /*
    On a wide screen the right pane would otherwise open empty, so the first
    person is selected for you. On a phone the same pane is a sheet — selecting
    for you would slide a dialog over a list nobody has touched yet — so there
    selection stays deliberate. Either way a selection that no longer exists
    (the member was removed) is dropped rather than left dangling.
  */
  useEffect(() => {
    if (selectedId && !people.some((person) => person.id === selectedId)) {
      setSelectedId(null);
      return;
    }
    if (!selectedId && !isMobile && people.length > 0) {
      setSelectedId(people[0].id);
    }
  }, [isMobile, people, selectedId]);

  const selected = people.find((person) => person.id === selectedId) ?? null;

  function grantCount(person: AccessPerson) {
    if (person.alwaysAllowed) return mailboxes.length;
    return mailboxes.filter((mailbox) => isGranted(person.id, mailbox.id))
      .length;
  }

  if (people.length === 0) {
    return (
      <p className="rounded-dialog border border-dashed p-6 text-center text-body text-text-secondary">
        {noPeopleMessage}
      </p>
    );
  }

  const peopleList = (
    <div className="flex flex-col">
      <div className="border-b p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
          <Input
            identifier
            value={personQuery}
            onChange={(event) => setPersonQuery(event.target.value)}
            placeholder="Search people…"
            aria-label="Search people"
            className="pl-control"
          />
        </div>
      </div>

      {visiblePeople.length === 0 ? (
        <p className="p-6 text-center text-body text-text-secondary">
          Nobody matches that search.
        </p>
      ) : (
        <ul aria-label="People">
          {visiblePeople.map((person) => {
            const count = grantCount(person);
            const active = person.id === selectedId;
            return (
              <li key={person.id}>
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => setSelectedId(person.id)}
                  className={cn(
                    "flex w-full items-center gap-3 border-b px-3 py-2.5 text-left transition-colors duration-fast ease-out last:border-0 hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    active && "bg-accent hover:bg-accent"
                  )}
                >
                  <Avatar name={person.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-body font-medium">
                      {person.name}
                    </div>
                    <div className="truncate text-meta text-text-tertiary">
                      {person.email}
                    </div>
                  </div>
                  {/*
                    The summary is the reason to scan this list at all: it says
                    who is over- or under-provisioned before you open anyone.
                  */}
                  <span className="shrink-0 text-meta text-text-tertiary">
                    {person.alwaysAllowed ? (
                      <span className="inline-flex items-center gap-1">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        All
                      </span>
                    ) : count === 0 ? (
                      "None"
                    ) : (
                      `${count} of ${mailboxes.length}`
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  const detail = selected ? (
    <PersonAccess
      key={selected.id}
      person={selected}
      groups={groups}
      totalMailboxes={mailboxes.length}
      grantCount={grantCount(selected)}
      isGranted={isGranted}
      onToggle={onToggle}
      pending={pending}
      disabled={disabled}
      noMailboxesMessage={noMailboxesMessage}
    />
  ) : null;

  if (isMobile) {
    return (
      <>
        <div className="overflow-hidden rounded-dialog border bg-surface">
          {peopleList}
        </div>
        <Sheet
          open={selected !== null}
          onOpenChange={(open) => {
            if (!open) setSelectedId(null);
          }}
        >
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>{selected?.name ?? "Access"}</SheetTitle>
            </SheetHeader>
            <SheetBody className="px-0 py-0">{detail}</SheetBody>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <div className="grid overflow-hidden rounded-dialog border bg-surface md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <div className="border-b md:border-b-0 md:border-r">{peopleList}</div>
      <div className="min-w-0">
        {detail ?? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center">
            <Users className="h-6 w-6 text-text-tertiary" />
            <p className="text-body text-text-secondary">
              Pick someone to see what they can send as.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

interface PersonAccessProps {
  person: AccessPerson;
  groups: { domain: string; mailboxes: AccessMailbox[] }[];
  totalMailboxes: number;
  grantCount: number;
  isGranted: (personId: string, mailboxId: string) => boolean;
  onToggle: (personId: string, mailboxId: string, next: boolean) => void;
  pending?: Set<string>;
  disabled: boolean;
  noMailboxesMessage: string;
}

/**
 * One person's sending surface: every mailbox they could send as, grouped by
 * domain, with the ones they hold ticked.
 *
 * Mounted with `key={person.id}` so switching people resets the search and the
 * filter — carrying "only what they can use" from one person to the next would
 * silently hide most of the next person's options.
 */
function PersonAccess({
  person,
  groups,
  totalMailboxes,
  grantCount,
  isGranted,
  onToggle,
  pending,
  disabled,
  noMailboxesMessage,
}: PersonAccessProps) {
  const [query, setQuery] = useState("");
  const [grantedOnly, setGrantedOnly] = useState(false);

  const holds = (mailbox: AccessMailbox) =>
    Boolean(person.alwaysAllowed) || isGranted(person.id, mailbox.id);

  const needle = query.trim().toLowerCase();
  const visibleGroups = groups
    .map((group) => ({
      domain: group.domain,
      // Counted before filtering: "2 of 5" describes the domain, not the
      // slice of it that survived a search.
      granted: group.mailboxes.filter(holds).length,
      total: group.mailboxes.length,
      mailboxes: group.mailboxes.filter((mailbox) => {
        if (grantedOnly && !holds(mailbox)) return false;
        if (!needle) return true;
        return (
          mailbox.address.toLowerCase().includes(needle) ||
          (mailbox.label ?? "").toLowerCase().includes(needle) ||
          group.domain.toLowerCase().includes(needle)
        );
      }),
    }))
    .filter((group) => group.mailboxes.length > 0);

  return (
    <div className="flex flex-col">
      <div className="border-b p-card">
        <div className="flex items-start gap-3">
          <Avatar name={person.name} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-ui font-semibold">
                {person.name}
              </span>
              <Badge variant="outline">{person.roleLabel}</Badge>
            </div>
            <p className="truncate text-meta text-text-tertiary">
              {person.email}
            </p>
          </div>
        </div>

        <p className="mt-3 flex items-start gap-2 text-body text-text-secondary">
          {person.alwaysAllowed ? (
            <>
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              {person.alwaysAllowedReason ??
                `${person.name} can send as every mailbox.`}
            </>
          ) : (
            <>
              <Mail className="mt-0.5 h-4 w-4 shrink-0" />
              {grantCount === 0
                ? `${person.name} can't send as any mailbox yet — tick the ones they should have.`
                : `${person.name} can send as ${grantCount} of ${totalMailboxes} mailboxes.`}
            </>
          )}
        </p>
      </div>

      {totalMailboxes === 0 ? (
        <p className="p-6 text-center text-body text-text-secondary">
          {noMailboxesMessage}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b p-3">
            <div className="relative min-w-0 flex-1 sm:w-field-search sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
              <Input
                identifier
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search mailboxes or domains…"
                aria-label="Search mailboxes"
                className="pl-control"
              />
            </div>
            {/*
              "Only what they can use" is how you audit rather than edit: on an
              org with several domains, the four addresses somebody actually
              holds are otherwise scattered down a list of thirty.
            */}
            <button
              type="button"
              aria-pressed={grantedOnly}
              onClick={() => setGrantedOnly((current) => !current)}
              className={cn(
                "inline-flex h-control shrink-0 items-center gap-2 rounded-control border px-3 text-body transition-colors duration-fast ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                grantedOnly
                  ? "border-primary bg-accent text-accent-foreground"
                  : "border-border-strong text-text-secondary hover:bg-surface-sunken"
              )}
            >
              <ListFilter className="h-4 w-4" />
              Only what they can use
            </button>
          </div>

          {visibleGroups.length === 0 ? (
            <p className="p-6 text-center text-body text-text-secondary">
              {grantedOnly && !needle
                ? `${person.name} can't send as anything yet.`
                : "No mailboxes match that search."}
            </p>
          ) : (
            <div>
              {visibleGroups.map((group) => (
                <section key={group.domain}>
                  <h4 className="flex items-center justify-between gap-2 border-b bg-surface-sunken px-3 py-1.5 text-meta font-semibold text-text-secondary">
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <Globe className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{group.domain}</span>
                    </span>
                    <span className="shrink-0 font-normal text-text-tertiary">
                      {person.alwaysAllowed
                        ? "All"
                        : `${group.granted} of ${group.total}`}
                    </span>
                  </h4>

                  <ul aria-label={`Mailboxes on ${group.domain}`}>
                    {group.mailboxes.map((mailbox) => {
                      const key = `${person.id}:${mailbox.id}`;
                      const busy = pending?.has(key) ?? false;
                      const granted = holds(mailbox);

                      const body = (
                        <>
                          <span
                            aria-hidden
                            className={cn(
                              "flex h-5 w-5 shrink-0 items-center justify-center rounded-control border transition-colors duration-fast ease-out",
                              granted
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border-strong bg-surface"
                            )}
                          >
                            {busy ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : granted ? (
                              person.alwaysAllowed ? (
                                <ShieldCheck className="h-3 w-3" />
                              ) : (
                                <Check className="h-3.5 w-3.5" />
                              )
                            ) : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-body">
                              {mailbox.address}
                            </span>
                            {mailbox.label &&
                            mailbox.label !== mailbox.address ? (
                              <span className="block truncate text-meta text-text-tertiary">
                                {mailbox.label}
                              </span>
                            ) : null}
                          </span>
                        </>
                      );

                      // Owners and admins hold every account by role, so there
                      // is nothing to toggle — the row states the fact instead
                      // of offering a control that would refuse to move.
                      if (person.alwaysAllowed) {
                        return (
                          <li
                            key={mailbox.id}
                            className="flex items-center gap-3 border-b px-3 py-2.5 text-text-secondary last:border-0"
                          >
                            {body}
                            <span className="shrink-0 text-meta text-text-tertiary">
                              Always
                            </span>
                          </li>
                        );
                      }

                      return (
                        <li key={mailbox.id}>
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={granted}
                            aria-label={`${person.name} can send as ${mailbox.address}`}
                            disabled={disabled || busy}
                            onClick={() =>
                              onToggle(person.id, mailbox.id, !granted)
                            }
                            className="flex w-full items-center gap-3 border-b px-3 py-2.5 text-left transition-colors duration-fast ease-out last:border-0 hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50"
                          >
                            {body}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
