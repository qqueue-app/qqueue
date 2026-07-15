import { type ReactNode, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { fetchSetupStatus } from "../lib/setup-status.js";

// Legal pages stay reachable pre-setup; everything else funnels into the
// first-run wizard while the instance has no users at all.
const EXEMPT_PATHS = new Set([
  "/setup",
  "/terms",
  "/privacy",
  "/licensing",
  "/trademark",
]);

/**
 * First-run gate: when the instance has zero users, every visit routes to the
 * /setup wizard. Once the first user exists this never redirects again — the
 * softer "finish setup" nudges live on the Dashboard instead.
 */
export function SetupGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    fetchSetupStatus()
      .then((status) => {
        if (
          !cancelled &&
          status.needsSetup &&
          !EXEMPT_PATHS.has(location.pathname)
        ) {
          navigate("/setup", { replace: true });
        }
      })
      .catch(() => {
        // API unreachable: render normally and let pages surface the existing
        // connection error.
      });
    return () => {
      cancelled = true;
    };
  }, [location.pathname, navigate]);

  return <>{children}</>;
}
