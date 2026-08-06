import type { Request, Response } from "express";
import { publicSendEmailSchema } from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import { logger } from "../../lib/logger.js";
import { transactionalEmailService } from "./service.js";

// Cap the client-supplied idempotency key so a caller can't store an unbounded
// string. 255 is generous for a UUID/hash while staying index-friendly.
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

export const transactionalEmailController = {
  async send(req: Request, res: Response) {
    const payload = publicSendEmailSchema.parse(req.body);

    const idempotencyKey = req.header("Idempotency-Key")?.trim() || undefined;
    if (idempotencyKey && idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new HttpError(
        400,
        `Idempotency-Key must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
        "validation_error"
      );
    }

    const input = {
      ...payload,
      organizationId: req.organizationId!,
      // JWT callers carry the acting user (send-as enforcement + attribution);
      // API-key callers have none — the key itself is the org credential.
      createdByUserId: req.userId ?? null,
      idempotencyKey
    };
    const result = await transactionalEmailService.send(input);
    // Correlates this request's log lines with the worker's job (Phase 5).
    logger.info(
      {
        reqId: req.id,
        organizationId: req.organizationId,
        emailJobId: result.id,
        status: result.status
      },
      "transactional send accepted"
    );
    res.status(202).json({ data: result });
  }
};
