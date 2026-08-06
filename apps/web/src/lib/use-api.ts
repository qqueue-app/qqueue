import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * Shape-check rather than `instanceof ApiError`: an error can cross a module
 * boundary (or a test's module mock) and lose its prototype identity while
 * still carrying everything we actually read off it.
 */
function apiErrorDetail(
  error: unknown
): { message?: string; issues?: { message?: string }[] } | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as { status?: unknown; issues?: unknown };
  if (typeof candidate.status !== "number") return null;
  return error as { message?: string; issues?: { message?: string }[] };
}

export function errorMessage(error: unknown, fallback: string) {
  const apiError = apiErrorDetail(error);
  if (apiError) {
    // Zod issues carry the useful detail; the envelope message is generic.
    const issue = apiError.issues?.[0];
    if (issue?.message) return issue.message;
    return apiError.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

/**
 * A query scoped to an organization. Passing a null/undefined organization id
 * disables the query rather than firing a request that would 400 — pages render
 * before the session context resolves.
 */
export function useOrgQuery<TData>(
  organizationId: string | null | undefined,
  key: QueryKey,
  fetcher: (organizationId: string) => Promise<TData>,
  options?: Omit<
    UseQueryOptions<TData, unknown, TData, QueryKey>,
    "queryKey" | "queryFn" | "enabled"
  > & { enabled?: boolean }
) {
  const { enabled = true, ...rest } = options ?? {};
  return useQuery<TData, unknown, TData, QueryKey>({
    queryKey: key,
    queryFn: () => fetcher(organizationId as string),
    enabled: Boolean(organizationId) && enabled,
    ...rest,
  });
}

export interface ApiMutationOptions<TData, TVariables>
  extends Omit<
    UseMutationOptions<TData, unknown, TVariables>,
    "mutationFn" | "onSuccess" | "onError"
  > {
  /** Toasted on success. Pass a function to build it from the result. */
  successMessage?: string | ((data: TData, variables: TVariables) => string);
  /** Toasted on failure, unless the API supplied a more specific message. */
  errorMessage?: string;
  /** Query keys to invalidate once the mutation settles. */
  invalidates?: QueryKey[] | ((variables: TVariables) => QueryKey[]);
  onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>;
  onError?: (error: unknown, variables: TVariables) => void;
}

/**
 * Mutation wrapper that standardises the three things every mutation in this
 * app did by hand: toast on success, toast the API's message on failure, and
 * invalidate the affected queries.
 */
export function useApiMutation<TData, TVariables = void>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  {
    successMessage,
    errorMessage: fallbackError = "Something went wrong.",
    invalidates,
    onSuccess,
    onError,
    ...options
  }: ApiMutationOptions<TData, TVariables> = {}
) {
  const queryClient = useQueryClient();

  return useMutation<TData, unknown, TVariables>({
    mutationFn,
    onSuccess: async (data, variables) => {
      const keys =
        typeof invalidates === "function" ? invalidates(variables) : invalidates;
      if (keys?.length) {
        await Promise.all(
          keys.map((key) => queryClient.invalidateQueries({ queryKey: key }))
        );
      }
      if (successMessage) {
        toast.success(
          typeof successMessage === "function"
            ? successMessage(data, variables)
            : successMessage
        );
      }
      await onSuccess?.(data, variables);
    },
    onError: (error, variables) => {
      toast.error(errorMessage(error, fallbackError));
      onError?.(error, variables);
    },
    ...options,
  });
}
