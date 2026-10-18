import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createSearchParams,
  useLocation,
  useNavigate,
  type Location,
  type SetURLSearchParams,
} from "react-router-dom";
import { Maximize2, Minimize2, Minus, X, PenSquare } from "lucide-react";
import { useMediaQuery } from "../../lib/use-media-query.js";
import { useSession } from "../../lib/session-context.js";
import { IconButton } from "../ui/icon-button.js";
import { Spinner } from "../ui/spinner.js";
const Composer = lazy(() =>
  import("../../pages/EmailStudio.js").then((module) => ({
    default: module.EmailStudio,
  }))
);

type ComposeState = "open" | "minimized" | "closed";
interface Workspace {
  routeLocation: Location;
  mounted: boolean;
  state: ComposeState;
  setState: (state: ComposeState) => void;
  params: URLSearchParams;
  setParams: SetURLSearchParams;
}
const Context = createContext<Workspace | null>(null);

/** Keep the writer mounted independently of mail navigation and URL filters. */
export function MailComposeProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { user, currentOrganizationId } = useSession();
  const identity = `${user?.id}:${currentOrganizationId}`;
  return (
    <ComposeSession key={identity} location={location}>
      {children}
    </ComposeSession>
  );
}
function ComposeSession({
  children,
  location,
}: {
  children: ReactNode;
  location: Location;
}) {
  const previous = useRef<Location>({
    ...location,
    pathname: "/inbox",
    search: "",
    hash: "",
  });
  const composing = location.pathname === "/email-studio";
  if (!composing) previous.current = location;
  const [mounted, setMounted] = useState(composing);
  const [state, setState] = useState<ComposeState>(
    composing ? "open" : "closed"
  );
  const [params, updateParams] = useState(
    () => new URLSearchParams(composing ? location.search : "")
  );
  useEffect(() => {
    if (!composing) return;
    setMounted(true);
    setState("open");
    // An ordinary Compose click resumes the current writing. An explicit draft
    // link is handled by the writer's existing preserve-and-open workflow.
    if (location.search) updateParams(new URLSearchParams(location.search));
  }, [composing, location.key, location.search]);
  const setParams: SetURLSearchParams = useCallback(
    (next) =>
      updateParams((current) =>
        createSearchParams(typeof next === "function" ? next(current) : next)
      ),
    []
  );
  return (
    <Context.Provider
      value={{
        routeLocation: composing ? previous.current : location,
        mounted,
        state,
        setState,
        params,
        setParams,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useMailComposeOpen() {
  return useContext(Context)?.state === "open";
}
export function useMailRouteLocation() {
  return useContext(Context)?.routeLocation;
}
export function ComposeHost({
  navigationBlocking = false,
}: { navigationBlocking?: boolean } = {}) {
  const workspace = useContext(Context);
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const mobile = useMediaQuery("(max-width: 639.98px)");
  const root = useRef<HTMLElement>(null);
  const open = workspace?.state === "open" && !navigationBlocking;
  const changeState = workspace?.setState;
  useEffect(() => {
    const element = root.current;
    if (!mobile || !open || !element) return;
    const previous = document.activeElement as HTMLElement | null;
    const background = Array.from(element.parentElement?.children ?? []).filter(
      (item) => item !== element && !item.hasAttribute("inert")
    );
    background.forEach((item) => item.setAttribute("inert", ""));
    element.focus({ preventScroll: true });
    const focusWriter = () => {
      const writer = element.querySelector<HTMLElement>(
        "#to,textarea,[contenteditable='true']"
      );
      if (writer) writer.focus({ preventScroll: true });
      return Boolean(writer);
    };
    const observer = new MutationObserver(() => {
      if (focusWriter()) observer.disconnect();
    });
    if (!focusWriter())
      observer.observe(element, { childList: true, subtree: true });
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        changeState?.("closed");
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        element.querySelectorAll<HTMLElement>(
          "button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[contenteditable='true']"
        )
      ).filter((item) => item.getClientRects().length > 0);
      const first = controls[0],
        last = controls[controls.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === element)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === element)
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    element.addEventListener("keydown", trap);
    return () => {
      observer.disconnect();
      element.removeEventListener("keydown", trap);
      background.forEach((item) => item.removeAttribute("inert"));
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [mobile, open, changeState]);
  if (!workspace?.mounted) return null;
  const { state, setState, params, setParams } = workspace;
  return (
    <section
      ref={root}
      tabIndex={-1}
      role={mobile && state === "open" ? "dialog" : undefined}
      aria-modal={mobile && state === "open" ? true : undefined}
      aria-label="Compose workspace"
      className={`mail-compose-window ${expanded ? "is-expanded" : ""} ${state === "minimized" ? "is-minimized" : ""}`}
      hidden={state === "closed" || navigationBlocking}
    >
      <div className="mail-compose-titlebar">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setState("open")}
        >
          <PenSquare className="h-4 w-4" />
          <span>New message</span>
        </button>
        <IconButton
          label={state === "minimized" ? "Restore compose" : "Minimize compose"}
          onClick={() => setState(state === "minimized" ? "open" : "minimized")}
        >
          <Minus />
        </IconButton>
        <IconButton
          label={expanded ? "Exit full screen" : "Expand compose"}
          onClick={() => {
            setExpanded(!expanded);
            setState("open");
          }}
        >
          {expanded ? <Minimize2 /> : <Maximize2 />}
        </IconButton>
        <IconButton
          label="Close and keep draft"
          onClick={() => {
            setState("closed");
            navigate(
              workspace.routeLocation.pathname + workspace.routeLocation.search,
              { replace: true }
            );
          }}
        >
          <X />
        </IconButton>
      </div>
      <div className="mail-compose-content" hidden={state === "minimized"}>
        <Suspense
          fallback={
            <div className="p-6">
              <Spinner />
            </div>
          }
        >
          <Composer docked queryState={[params, setParams]} />
        </Suspense>
      </div>
    </section>
  );
}
