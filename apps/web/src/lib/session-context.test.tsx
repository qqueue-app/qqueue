import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { SessionProvider, useSession } from "./session-context.js";
import { getSession } from "./session.js";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SessionProvider>{children}</SessionProvider>
);

describe("SessionProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts unauthenticated with no organizations", () => {
    const { result } = renderHook(() => useSession(), { wrapper });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.organizations).toEqual([]);
    expect(result.current.currentOrganization).toBeUndefined();
  });

  it("setSession persists and marks authenticated", () => {
    const { result } = renderHook(() => useSession(), { wrapper });
    act(() =>
      result.current.setSession({
        user: { id: "u1", email: "a@b.com" },
        accessToken: "tok",
        organizations: [{ id: "o1", name: "Acme" }],
        currentOrganizationId: "o1"
      })
    );
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.email).toBe("a@b.com");
    expect(result.current.currentOrganization?.name).toBe("Acme");
    expect(getSession().accessToken).toBe("tok");
  });

  it("setCurrentOrganizationId updates the active org", () => {
    const { result } = renderHook(() => useSession(), { wrapper });
    act(() =>
      result.current.setSession({
        organizations: [
          { id: "o1", name: "A" },
          { id: "o2", name: "B" }
        ]
      })
    );
    act(() => result.current.setCurrentOrganizationId("o2"));
    expect(result.current.currentOrganizationId).toBe("o2");
    expect(result.current.currentOrganization?.name).toBe("B");
    expect(getSession().currentOrganizationId).toBe("o2");
  });

  it("addOrganization appends and activates a new org", () => {
    const { result } = renderHook(() => useSession(), { wrapper });
    act(() => result.current.addOrganization({ id: "o1", name: "Acme" }));
    expect(result.current.organizations).toHaveLength(1);
    expect(result.current.currentOrganizationId).toBe("o1");
  });

  it("addOrganization updates an existing org without duplicating", () => {
    const { result } = renderHook(() => useSession(), { wrapper });
    act(() => result.current.addOrganization({ id: "o1", name: "Acme" }));
    act(() =>
      result.current.addOrganization({ id: "o1", name: "Renamed" }, false)
    );
    expect(result.current.organizations).toHaveLength(1);
    expect(result.current.organizations[0].name).toBe("Renamed");
  });

  it("signOut clears the session", () => {
    const { result } = renderHook(() => useSession(), { wrapper });
    act(() =>
      result.current.setSession({
        user: { id: "u1", email: "a@b.com" },
        accessToken: "tok",
        organizations: [{ id: "o1", name: "Acme" }]
      })
    );
    act(() => result.current.signOut());
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.organizations).toEqual([]);
    expect(getSession().accessToken).toBeUndefined();
  });

  it("throws when useSession is used outside the provider", () => {
    expect(() => renderHook(() => useSession())).toThrow(
      "useSession must be used within a SessionProvider"
    );
  });
});
