import { createHash, randomBytes } from "node:crypto";
import type { ApiKeyCreateInput } from "@qqueue/shared";
import { assertOrgAccess, assertOrgRole } from "../../lib/org-access.js";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";

const API_KEY_PREFIX = "qq_live_";

const apiKeySelect = {
  id: true,
  organizationId: true,
  userId: true,
  name: true,
  lastUsedAt: true,
  createdAt: true,
  revokedAt: true
};

export function hashApiKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

function generateApiKey() {
  return `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export const apiKeyService = {
  list(organizationId: string, userId: string) {
    return assertOrgAccess(userId, organizationId).then(() =>
      prisma.apiKey.findMany({
        where: { organizationId },
        select: apiKeySelect,
        orderBy: { createdAt: "desc" }
      })
    );
  },

  async create(input: ApiKeyCreateInput, userId: string) {
    await assertOrgRole(userId, input.organizationId, ["OWNER", "ADMIN"]);

    const key = generateApiKey();
    const apiKey = await prisma.apiKey.create({
      data: {
        organizationId: input.organizationId,
        userId,
        name: input.name,
        keyHash: hashApiKey(key)
      },
      select: apiKeySelect
    });

    return { apiKey, key };
  },

  async revoke(id: string, userId: string) {
    const existing = await prisma.apiKey.findFirst({
      where: { id },
      select: { id: true, organizationId: true }
    });

    if (!existing) {
      throw new HttpError(404, "API key not found");
    }

    await assertOrgRole(userId, existing.organizationId, ["OWNER", "ADMIN"]);

    return prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
      select: apiKeySelect
    });
  },

  async authenticate(key: string) {
    if (!key.startsWith(API_KEY_PREFIX)) {
      return null;
    }

    const existing = await prisma.apiKey.findFirst({
      where: {
        keyHash: hashApiKey(key),
        revokedAt: null
      },
      select: { id: true, organizationId: true }
    });

    if (!existing) {
      return null;
    }

    await prisma.apiKey.update({
      where: { id: existing.id },
      data: { lastUsedAt: new Date() },
      select: { id: true }
    });

    return existing;
  }
};
