import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "../lib/http-error.js";
import {
  isPrismaKnownRequestError,
  uniqueConstraintFields,
  type PrismaKnownRequestError
} from "../lib/prisma-error.js";

// How to name a model in a user-facing message. Falls back to "record", so a
// model missing here degrades to a vaguer message rather than a wrong one.
// SMTPConnection follows the UI's "sending account" label (see CLAUDE.md).
const MODEL_LABELS: Record<string, string> = {
  ApiKey: "API key",
  Campaign: "campaign",
  Contact: "contact",
  ContactList: "contact list",
  ContactListMember: "list member",
  DomainThrottle: "throttle rule",
  InboxAccount: "inbox account",
  Organization: "organization",
  Segment: "segment",
  SMTPConnection: "sending account",
  Suppression: "suppression",
  Template: "template",
  User: "user",
  WebhookEndpoint: "webhook endpoint"
};

const FIELD_LABELS: Record<string, string> = {
  email: "email address",
  domain: "domain",
  name: "name",
  idempotencyKey: "idempotency key"
};

/**
 * Turn a unique-constraint violation into something a user can act on:
 * "A contact with this email address already exists" beats "Resource already
 * exists" when they are staring at a form.
 */
function conflictMessage(error: PrismaKnownRequestError): string {
  const subject = MODEL_LABELS[error.meta?.modelName ?? ""] ?? "record";
  const fields = uniqueConstraintFields(error).map(
    (field) => FIELD_LABELS[field] ?? field
  );

  if (fields.length === 0) {
    return `That ${subject} already exists`;
  }

  const article = /^[aeiou]/i.test(subject) ? "An" : "A";
  return `${article} ${subject} with this ${fields.join(" and ")} already exists`;
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (error instanceof HttpError) {
    res.status(error.statusCode).json({
      error: {
        ...(error.code ? { code: error.code } : {}),
        message: error.message
      }
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "validation_error",
        message: "Invalid request body",
        issues: error.issues
      }
    });
    return;
  }

  if (isPrismaKnownRequestError(error, "P2025")) {
    res.status(404).json({
      error: {
        code: "not_found",
        message: "Resource not found"
      }
    });
    return;
  }

  if (isPrismaKnownRequestError(error, "P2002")) {
    res.status(409).json({
      error: {
        code: "conflict",
        message: conflictMessage(error)
      }
    });
    return;
  }

  console.error(error);

  res.status(500).json({
    error: {
      message: "Internal server error"
    }
  });
}
