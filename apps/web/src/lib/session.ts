const sessionKey = "qqueue.session";

export interface SessionOrganization {
  id: string;
  name: string;
  role?: string;
}

export interface SessionData {
  user?: {
    id: string;
    email: string;
    name?: string | null;
  };
  accessToken?: string;
  refreshToken?: string;
  currentOrganizationId?: string;
  organizations: SessionOrganization[];
}

let windowSession: SessionData = { organizations: [] };
let preferWindowSession = false;
const listeners = new Set<(session: SessionData) => void>();
let notification = 0;
function notifySession() {
  const current = ++notification;
  queueMicrotask(() => {
    if (current === notification)
      for (const listener of listeners) listener(windowSession);
  });
}
function parseSession(raw: string | null): SessionData {
  try {
    const parsed = raw ? (JSON.parse(raw) as SessionData) : null;
    return parsed && Array.isArray(parsed.organizations)
      ? parsed
      : { organizations: [] };
  } catch {
    return { organizations: [] };
  }
}
export function getSession(): SessionData {
  if (preferWindowSession) return windowSession;
  try {
    windowSession = parseSession(window.localStorage.getItem(sessionKey));
  } catch {
    /* The active window still has its authenticated session. */
  }
  return windowSession;
}

export function saveSession(session: SessionData): boolean {
  windowSession = session;
  try {
    window.localStorage.setItem(sessionKey, JSON.stringify(session));
    preferWindowSession = false;
  } catch {
    preferWindowSession = true;
  }
  notifySession();
  return !preferWindowSession;
}

export function clearSession(): boolean {
  windowSession = { organizations: [] };
  preferWindowSession = true;
  try {
    window.localStorage.removeItem(sessionKey);
    preferWindowSession = false;
  } catch {
    /* Never reuse the previous session within this window. */
  }
  notifySession();
  return !preferWindowSession;
}

export function subscribeSession(listener: (session: SessionData) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
/** A peer's sign-in/sign-out supersedes a volatile session in this window. */
export function receiveSessionStorageChange(raw: string | null) {
  windowSession = parseSession(raw);
  preferWindowSession = false;
  notifySession();
}

export function getCurrentOrganizationId() {
  return getSession().currentOrganizationId;
}

export function updateTokens(tokens: {
  accessToken: string;
  refreshToken: string;
}) {
  const session = getSession();
  saveSession({
    ...session,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
}
