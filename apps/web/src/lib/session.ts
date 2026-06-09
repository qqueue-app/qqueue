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

export function getSession(): SessionData {
  const rawSession = window.localStorage.getItem(sessionKey);

  if (!rawSession) {
    return { organizations: [] };
  }

  try {
    return JSON.parse(rawSession) as SessionData;
  } catch {
    return { organizations: [] };
  }
}

export function saveSession(session: SessionData) {
  window.localStorage.setItem(sessionKey, JSON.stringify(session));
}

export function clearSession() {
  window.localStorage.removeItem(sessionKey);
}

export function getCurrentOrganizationId() {
  return getSession().currentOrganizationId;
}
