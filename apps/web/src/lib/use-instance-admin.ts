import { useQuery } from "@tanstack/react-query";
import { ApiError, api, type InstanceSettings } from "./api.js";
import { qk } from "./query-client.js";

/**
 * Whether the signed-in user administers this *instance* — a different thing
 * from being an OWNER of an organization, and deliberately not carried on the
 * session: the server is the authority and it decides per request.
 *
 * There is no "am I an instance admin?" endpoint, so this asks the question the
 * only way available: fetch the settings and read the answer off the status.
 * A 403 is the expected reply for most people, so it resolves to `null` rather
 * than throwing — an error here would fire the global "couldn't load" toast at
 * every ordinary member who opened Settings.
 *
 * Shared by the Settings hub (which hides the Instance row) and the Instance
 * page itself, so the two can't disagree about who may see it, and the answer
 * is fetched once for both.
 */
export function useInstanceAdmin() {
  const query = useQuery<InstanceSettings | null>({
    queryKey: qk.instanceSettings(),
    queryFn: async () => {
      try {
        return await api.getInstanceSettings();
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) {
          return null;
        }
        throw error;
      }
    },
    retry: false,
  });

  return {
    /**
     * `undefined` until the probe settles — render neither branch before then.
     * A failed probe reads as "not an admin": hiding a control someone is
     * entitled to costs them a reload, showing one they aren't costs a 403.
     */
    isInstanceAdmin: query.isPending ? undefined : Boolean(query.data),
    settings: query.data ?? null,
    isPending: query.isPending,
  };
}
