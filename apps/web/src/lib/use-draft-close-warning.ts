import { useEffect, useRef } from "react";
import { warnBeforeClosing } from "./window-drafts.js";
/** Cover the brief interval before a debounce has persisted the latest edit. */
export function useDraftCloseWarning(unsaved: boolean) {
  const current = useRef(unsaved);
  current.current = unsaved;
  useEffect(() => {
    const closing = (event: BeforeUnloadEvent) => {
      if (current.current) warnBeforeClosing(event);
    };
    window.addEventListener("beforeunload", closing);
    return () => window.removeEventListener("beforeunload", closing);
  }, []);
}
