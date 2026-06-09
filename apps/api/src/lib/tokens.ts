import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { HttpError } from "./http-error.js";

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

function safeEqual(a: string, b: string) {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  // timingSafeEqual throws on length mismatch; guard first.
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}

function verifyToken(
  token: string,
  secret: string,
  expectedType: TokenPayload["type"]
): TokenPayload {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new HttpError(401, "Malformed token");
  }

  const [header, body, signature] = parts;
  if (!safeEqual(signature, sign(`${header}.${body}`, secret))) {
    throw new HttpError(401, "Invalid token signature");
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(body, "base64url").toString()
    ) as TokenPayload;
  } catch {
    throw new HttpError(401, "Malformed token payload");
  }

  if (payload.type !== expectedType) {
    throw new HttpError(401, "Unexpected token type");
  }

  if (
    typeof payload.exp !== "number" ||
    payload.exp < Math.floor(Date.now() / 1000)
  ) {
    throw new HttpError(401, "Token expired");
  }

  return payload;
}

export function verifyAccessToken(token: string) {
  return verifyToken(token, env.JWT_ACCESS_SECRET, "access");
}

export function verifyRefreshToken(token: string) {
  return verifyToken(token, env.JWT_REFRESH_SECRET, "refresh");
}
