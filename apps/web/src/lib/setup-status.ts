import { api, type SetupStatus } from "./api.js";

// One fetch per page load, shared by SetupGate, Login, and the Dashboard.
// Failures are not cached so a flaky API doesn't wedge the app in either state.
let cached: Promise<SetupStatus> | null = null;

export function fetchSetupStatus(force = false): Promise<SetupStatus> {
  if (!cached || force) {
    const next = Promise.resolve()
      .then(() => api.setupStatus())
      .catch((error: unknown) => {
        if (cached === next) {
          cached = null;
        }
        throw error;
      });
    cached = next;
  }
  return cached;
}

export function invalidateSetupStatus(): void {
  cached = null;
}
