import { createHash } from "node:crypto";
import { prisma } from "./prisma.js";

/**
 * Server-side refresh-token records (Phase 5). The JWT signature proves who
 * minted a token; the row here proves it is still *alive*. Refresh requires
 * both, rotates the row, logout revokes it, and a password reset deletes
 * every row for the user.
 */

// Must match the refresh JWT's exp in lib/tokens.ts (30 days).
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Two tabs can race a refresh: the loser presents the token the winner just
// rotated away. Within this window a freshly-revoked token still refreshes
// (issuing its own new pair) instead of logging the user out.
export const ROTATION_GRACE_MS = 60_000;

/** Tokens are 256-bit-entropy JWTs; an unsalted sha256 lookup hash is fine. */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function persistRefreshToken(
  userId: string,
  refreshToken: string
) {
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });
}

/** Best-effort per-user cleanup, piggybacked on login so no cron is needed. */
export async function pruneRefreshTokens(userId: string) {
  const now = Date.now();
  try {
    await prisma.refreshToken.deleteMany({
      where: {
        userId,
        OR: [
          { expiresAt: { lt: new Date(now) } },
          { revokedAt: { lt: new Date(now - 24 * 60 * 60 * 1000) } },
        ],
      },
    });
  } catch {
    // Cleanup must never fail a login.
  }
}
