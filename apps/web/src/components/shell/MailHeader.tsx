import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Menu,
  Search,
  Settings,
  X,
  SlidersHorizontal,
  CircleHelp,
} from "lucide-react";
import { BrandWordmark } from "../BrandWordmark.js";
import { IconButton } from "../ui/icon-button.js";
import { Button } from "../ui/button.js";
import { Label } from "../ui/label.js";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { AccountMenu } from "./AccountMenu.js";
import { api } from "../../lib/api.js";
import { qk } from "../../lib/query-client.js";
import { useOrgQuery } from "../../lib/use-api.js";
import { useSession } from "../../lib/session-context.js";
const searchScopes = ["ALL", "RECEIVED", "SENT", "DRAFTS"] as const;

export function MailHeader({ onMenu }: { onMenu: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, currentOrganizationId: org } = useSession();
  const query = new URLSearchParams(location.search).get("q") ?? "";
  const address = new URLSearchParams(location.search).get("address") ?? "";
  const currentScope =
    new URLSearchParams(location.search).get("scope") ?? "ALL";
  const [search, setSearch] = useState(query);
  const [mailbox, setMailbox] = useState(address);
  const [scope, setScope] = useState(currentScope);
  const [options, setOptions] = useState(false);
  const [help, setHelp] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const mailboxes = useOrgQuery(
    org,
    qk.searchableMailboxes(org ?? "", user?.id ?? ""),
    (id) => api.searchableMailboxes(id),
    { enabled: options }
  );
  useEffect(() => {
    setSearch(query);
    setMailbox(address);
    setScope(currentScope);
  }, [query, address, currentScope]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (event.target as HTMLElement)?.closest(
          "input,textarea,select,[contenteditable='true'],[role='dialog'],[role='menu']"
        )
      )
        return;
      if (event.key === "/") {
        event.preventDefault();
        field.current?.focus();
      }
      if (event.key === "c") {
        event.preventDefault();
        navigate("/email-studio");
      }
      if (event.key === "?") {
        event.preventDefault();
        setHelp(true);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [navigate]);
  function submitSearch() {
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (mailbox) params.set("address", mailbox);
    if (
      searchScopes.includes(scope as (typeof searchScopes)[number]) &&
      scope !== "ALL"
    )
      params.set("scope", scope);
    navigate(`/search${params.size ? `?${params}` : ""}`);
    setOptions(false);
  }
  return (
    <header className="mail-app-header">
      <div className="mail-brand">
        <IconButton label="Open navigation" size="lg" onClick={onMenu}>
          <Menu />
        </IconButton>
        <Link to="/inbox" aria-label="QQueue home">
          <BrandWordmark />
        </Link>
      </div>
      <form
        role="search"
        className="mail-global-search"
        onSubmit={(event) => {
          event.preventDefault();
          submitSearch();
        }}
      >
        <IconButton label="Search all mail" type="submit" shortcut="/">
          <Search />
        </IconButton>
        <input
          ref={field}
          type="search"
          aria-label="Search all mail"
          placeholder="Search mail"
          value={search}
          maxLength={200}
          onChange={(event) => setSearch(event.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        {search ? (
          <IconButton
            label="Clear mail search"
            onClick={() => {
              setSearch("");
              field.current?.focus();
            }}
          >
            <X />
          </IconButton>
        ) : null}
        <Popover open={options} onOpenChange={setOptions}>
          <PopoverTrigger asChild>
            <IconButton label="Search options">
              <SlidersHorizontal />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-[min(26rem,calc(100vw-2rem))] space-y-4 p-5"
          >
            <p className="font-medium text-text">Search your mail</p>
            <div className="space-y-2">
              <Label htmlFor="mail-search-scope">Look in</Label>
              <select
                id="mail-search-scope"
                className="mail-search-select"
                value={scope}
                onChange={(event) => setScope(event.target.value)}
              >
                <option value="ALL">Received and sent mail</option>
                <option value="RECEIVED">Received mail</option>
                <option value="SENT">Sent mail</option>
                <option value="DRAFTS">Your drafts</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mail-search-account">Mailbox</Label>
              <select
                id="mail-search-account"
                className="mail-search-select"
                value={mailbox}
                onChange={(event) => setMailbox(event.target.value)}
              >
                <option value="">All assigned mailboxes</option>
                {mailbox &&
                !mailboxes.data?.some((item) => item.email === mailbox) ? (
                  <option value={mailbox}>{mailbox} (unavailable)</option>
                ) : null}
                {(mailboxes.data ?? []).map((item) => (
                  <option key={item.email} value={item.email}>
                    {item.email}
                  </option>
                ))}
              </select>
            </div>
            {mailboxes.isError ? (
              <p className="text-meta" role="alert">
                Couldn't load mailbox choices.{" "}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void mailboxes.refetch()}
                >
                  Retry
                </Button>
              </p>
            ) : null}
            <p className="text-meta text-text-secondary">
              Received mail includes connected folders. Personal drafts stay
              private.
            </p>
            <Button
              type="button"
              className="rounded-full"
              onClick={submitSearch}
            >
              Search
            </Button>
          </PopoverContent>
        </Popover>
      </form>
      <div className="mail-header-account">
        <IconButton
          label="Keyboard shortcuts"
          shortcut="?"
          onClick={() => setHelp(true)}
          className="hidden sm:inline-flex"
        >
          <CircleHelp />
        </IconButton>
        <IconButton label="Mail settings" asChild>
          <Link to="/settings">
            <Settings />
          </Link>
        </IconButton>
        <AccountMenu compact />
      </div>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>
              Mail shortcuts stay out of the way while you type.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[1fr_auto] gap-3 text-ui">
            <dt>Search mail</dt>
            <dd>
              <kbd>/</kbd>
            </dd>
            <dt>Compose</dt>
            <dd>
              <kbd>c</kbd>
            </dd>
            <dt>Shortcut help</dt>
            <dd>
              <kbd>?</kbd>
            </dd>
            <dt>Next or previous mail row</dt>
            <dd>
              <kbd>j</kbd> / <kbd>k</kbd>
            </dd>
            <dt>Open the focused message</dt>
            <dd>
              <kbd>Enter</kbd>
            </dd>
            <dt>Back from a conversation</dt>
            <dd>
              <kbd>Esc</kbd>
            </dd>
          </dl>
          <p className="text-meta text-text-secondary">
            Use j and k while focused in a mail list. Tab moves between
            controls.
          </p>
        </DialogContent>
      </Dialog>
    </header>
  );
}
