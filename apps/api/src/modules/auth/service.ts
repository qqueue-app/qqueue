import type { LoginInput, RegisterInput } from "@qqueue/shared";
import type { Prisma } from "@prisma/client";
import { HttpError } from "../../lib/http-error.js";
import { hashPassword, verifyPassword } from "../../lib/crypto.js";
import { prisma } from "../../lib/prisma.js";
import { createAuthTokens, verifyRefreshToken } from "../../lib/tokens.js";

function serializeUser(user: {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString()
  };
}

type UserOrganizationMember = {
  organization: {
    id: string;
    name: string;
  };
  role: string;
};

export const authService = {
  async register(input: RegisterInput) {
    const passwordHash = await hashPassword(input.password);

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash
        }
      });

      const organization = await tx.organization.create({
        data: {
          name: input.organizationName ?? `${input.email}'s organization`,
          members: {
            create: {
              userId: user.id,
              role: "OWNER"
            }
          }
        }
      });

      return { user, organization };
    });

    return {
      user: serializeUser(result.user),
      organization: result.organization,
      tokens: createAuthTokens(result.user)
    };
  },

  async login(input: LoginInput) {
    const user = await prisma.user.findUnique({
      where: { email: input.email },
      include: {
        members: {
          include: {
            organization: true
          }
        }
      }
    });

    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new HttpError(401, "Invalid email or password");
    }

    return {
      user: serializeUser(user),
      organizations: user.members.map((member: UserOrganizationMember) => ({
        id: member.organization.id,
        name: member.organization.name,
        role: member.role
      })),
      tokens: createAuthTokens(user)
    };
  },

  async refresh(refreshToken: string) {
    const payload = verifyRefreshToken(refreshToken);

    const user = await prisma.user.findUnique({
      where: { id: payload.sub }
    });

    if (!user) {
      throw new HttpError(401, "Invalid refresh token");
    }

    return { tokens: createAuthTokens(user) };
  }
};
