import { createHmac } from "node:crypto";
import { env } from "../config/env.js";

interface TokenPayload {
  sub: string;
  email: string;
  type: "access" | "refresh";
  exp: number;
}

function encodeJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(unsignedToken: string, secret: string) {
  return createHmac("sha256", secret).update(unsignedToken).digest("base64url");
}

function createToken(payload: TokenPayload, secret: string) {
  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const body = encodeJson(payload);
  const unsignedToken = `${header}.${body}`;

  return `${unsignedToken}.${sign(unsignedToken, secret)}`;
}

export function createAuthTokens(user: { id: string; email: string }) {
  const now = Math.floor(Date.now() / 1000);

  return {
    accessToken: createToken(
      {
        sub: user.id,
        email: user.email,
        type: "access",
        exp: now + 60 * 15
      },
      env.JWT_ACCESS_SECRET
    ),
    refreshToken: createToken(
      {
        sub: user.id,
        email: user.email,
        type: "refresh",
        exp: now + 60 * 60 * 24 * 30
      },
      env.JWT_REFRESH_SECRET
    )
  };
}
