import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  clearSession,
  getSession,
  saveSession,
  subscribeSession,
  receiveSessionStorageChange,
  type SessionData,
  type SessionOrganization,
} from "./session.js";
import { api } from "./api.js";

interface SessionContextValue {
  session: SessionData;
  user: SessionData["user"];
  organizations: SessionOrganization[];
  currentOrganizationId?: string;
  currentOrganization?: SessionOrganization;
  isAuthenticated: boolean;
  setSession: (next: SessionData) => void;
  setCurrentOrganizationId: (organizationId: string) => void;
  addOrganization: (
    organization: SessionOrganization,
    makeActive?: boolean
  ) => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<SessionData>(getSession);

  useEffect(() => {
    const unsubscribe = subscribeSession(setSessionState);
    const changed = (event: StorageEvent) => {
      if (event.key === "qqueue.session" || event.key === null)
        receiveSessionStorageChange(event.newValue);
    };
    window.addEventListener("storage", changed);
    return () => {
      unsubscribe();
      window.removeEventListener("storage", changed);
    };
  }, []);

  const setSession = useCallback((next: SessionData) => {
    saveSession(next);
    setSessionState(next);
  }, []);

  const setCurrentOrganizationId = useCallback((organizationId: string) => {
    setSessionState(() => {
      const latest = getSession();
      const next = { ...latest, currentOrganizationId: organizationId };
      saveSession(next);
      return next;
    });
  }, []);

  const addOrganization = useCallback(
    (organization: SessionOrganization, makeActive = true) => {
      setSessionState(() => {
        const prev = getSession();
        const exists = prev.organizations.some(
          (item) => item.id === organization.id
        );
        const organizations = exists
          ? prev.organizations.map((item) =>
              item.id === organization.id ? organization : item
            )
          : [...prev.organizations, organization];
        const next: SessionData = {
          ...prev,
          organizations,
          currentOrganizationId: makeActive
            ? organization.id
            : prev.currentOrganizationId,
        };
        saveSession(next);
        return next;
      });
    },
    []
  );

  const signOut = useCallback(() => {
    // Revoke the refresh token server-side too (Phase 5) — best-effort, and
    // read before the local session is cleared. Local sign-out never waits on
    // (or fails because of) the network.
    const { refreshToken } = getSession();
    if (refreshToken) {
      void api.logout(refreshToken).catch(() => undefined);
    }
    clearSession();
    setSessionState({ organizations: [] });
  }, []);

  const value = useMemo<SessionContextValue>(() => {
    const currentOrganization = session.organizations.find(
      (organization) => organization.id === session.currentOrganizationId
    );
    return {
      session,
      user: session.user,
      organizations: session.organizations,
      currentOrganizationId: session.currentOrganizationId,
      currentOrganization,
      isAuthenticated: Boolean(session.user && session.accessToken),
      setSession,
      setCurrentOrganizationId,
      addOrganization,
      signOut,
    };
  }, [session, setSession, setCurrentOrganizationId, addOrganization, signOut]);

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return context;
}
