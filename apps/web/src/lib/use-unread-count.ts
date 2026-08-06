import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api.js";
import { qk } from "./query-client.js";
import { useSession } from "./session-context.js";

/**
 * Unread inbox count for the navigation badge and the browser tab title.
 *
 * Polls on a slow cadence rather than relying on push: push only reaches
 * devices that granted permission, and the badge has to be right for everyone
 * else too. The interval matches the worker's default IMAP sync cadence —
 * checking more often than mail can arrive is pure waste.
 */
export function useUnreadCount(): number {
  const { currentOrganizationId } = useSession();

  const { data } = useQuery({
    queryKey: qk.inboxUnreadCount(currentOrganizationId ?? ""),
    queryFn: () => api.inboxUnreadCount(currentOrganizationId as string),
    enabled: Boolean(currentOrganizationId),
    refetchInterval: 120_000,
    staleTime: 60_000,
    // A failed count must never surface as an error toast or an empty screen —
    // it is decoration on the nav, not content.
    retry: false,
    meta: { silent: true },
  });

  const count = data?.count ?? 0;

  // Mirror the count into the tab title, the way every webmail client does, so
  // an unfocused tab still tells you something arrived.
  useEffect(() => {
    const base = "QQueue";
    document.title = count > 0 ? `(${count}) ${base}` : base;
    return () => {
      document.title = base;
    };
  }, [count]);

  return count;
}
