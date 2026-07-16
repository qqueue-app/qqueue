/**
 * Shape-based detection for Prisma's known request errors.
 *
 * `error instanceof PrismaClientKnownRequestError` does NOT work here and must
 * not be used: @prisma/client's exports map resolves
 * `@prisma/client/runtime/library` to `runtime/library.mjs` for ESM importers
 * (this app), while the generated client itself is CommonJS and requires
 * `runtime/library.js`. Both copies are loaded, each defining its own error
 * class, so an error thrown by the client is never an instance of the class we
 * import — the check silently fails and every duplicate/not-found ends up a 500.
 * (Unit tests that construct the error themselves get the ESM copy and pass,
 * which is why this hid for so long.)
 *
 * Matching on `name` + `code` is stable across both copies.
 */
export interface PrismaKnownRequestError {
  name: string;
  /** Prisma error code, e.g. "P2002" (unique violation), "P2025" (not found). */
  code: string;
  meta?: {
    /** Columns of the violated unique constraint, for P2002. */
    target?: string[] | string;
    modelName?: string;
  };
}

export function isPrismaKnownRequestError(
  error: unknown,
  code?: string
): error is PrismaKnownRequestError {
  if (
    typeof error !== "object" ||
    error === null ||
    (error as { name?: unknown }).name !== "PrismaClientKnownRequestError" ||
    typeof (error as { code?: unknown }).code !== "string"
  ) {
    return false;
  }
  return code === undefined || (error as { code: string }).code === code;
}

/**
 * Fields of the unique constraint a P2002 tripped on, minus the tenant scoping
 * column: `@@unique([organizationId, email])` is a duplicate *email* as far as
 * the user is concerned.
 */
export function uniqueConstraintFields(
  error: PrismaKnownRequestError
): string[] {
  const target = error.meta?.target;
  const fields = Array.isArray(target)
    ? target
    : typeof target === "string"
      ? [target]
      : [];
  return fields.filter((field) => field !== "organizationId");
}
