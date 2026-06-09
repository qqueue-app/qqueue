import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";
import {
  clearSession,
  getSession,
  saveSession,
  type SessionData,
  type SessionOrganization
} from "./session.js";

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

  const setSession = useCallback((next: SessionData) => {
    saveSession(next);
    setSessionState(next);
  }, []);

  const setCurrentOrganizationId = useCallback((organizationId: string) => {
    setSessionState((prev) => {
      const next = { ...prev, currentOrganizationId: organizationId };
      saveSession(next);
      return next;
    });
  }, []);

  const addOrganization = useCallback(
    (organization: SessionOrganization, makeActive = true) => {
      setSessionState((prev) => {
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
            : prev.currentOrganizationId
        };
        saveSession(next);
        return next;
      });
    },
    []
  );

  const signOut = useCallback(() => {
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
      signOut
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
