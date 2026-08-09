import { useQuery } from "@tanstack/react-query";
import { ApiError, api } from "./api.js";
import { qk } from "./query-client.js";

/**
 * Whether the signed-in user administers this *instance* — a different thing
 * from being an OWNER of an organization, since anyone may create an org and
 * own it. Deliberately not read off the stored session: that is written once at
 * sign-in and never revalidated, so a flag flipped server-side would not land
 * until the next sign-out. The server is the authority and it answers per
 * request.
 *
 * Reads `GET /auth/me`. This used to infer the answer by fetching instance
 * settings and treating a 403 as "no", which worked for one boolean but could
 * not carry anything else and made every ordinary member's Settings visit
 * generate an expected-403. An auth failure still resolves to "not an admin"
 * rather than throwing, so a stale token can't fire the global error toast.
 *
 * Shared by the Settings hub (which hides the instance rows) and by every
 * instance page, so the two can't disagree about who may see what, and the
 * answer is fetched once for all of them.
 */
export function useInstanceAdmin() {
  const query = useQuery({
    queryKey: qk.me(),
    queryFn: async () => {
      try {
        return await api.getMe();
      } catch (error) {
        if (
          error instanceof ApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          return null;
        }
        throw error;
      }
    },
    retry: false,
  });

  return {
    /**
     * `undefined` until the query settles — render neither branch before then.
     * A failed read counts as "not an admin": hiding a control someone is
     * entitled to costs them a reload, showing one they aren't costs a 403.
     */
    isInstanceAdmin: query.isPending
      ? undefined
      : Boolean(query.data?.user.isInstanceAdmin),
    user: query.data?.user ?? null,
    isPending: query.isPending,
  };
}
