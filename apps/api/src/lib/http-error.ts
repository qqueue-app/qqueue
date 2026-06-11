import type { ApiErrorCode } from "@qqueue/shared";

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: ApiErrorCode
  ) {
    super(message);
    this.name = "HttpError";
  }
}
