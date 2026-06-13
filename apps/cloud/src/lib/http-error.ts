// SPDX-License-Identifier: LicenseRef-QQueue-Commercial
// Copyright (C) 2026 Nana Aboagye Boateng

// Machine-readable error codes for the cloud API surface. Kept local to the
// proprietary boundary; core error codes live in @qqueue/shared.
export type CloudErrorCode =
  | "not_implemented"
  | "billing_provider_unconfigured"
  | "plan_not_found"
  | "quota_exceeded"
  | "validation_error";

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: CloudErrorCode
  ) {
    super(message);
    this.name = "HttpError";
  }
}

// Thrown by scaffold endpoints whose behavior has not been implemented yet.
export class NotImplementedError extends HttpError {
  constructor(feature: string) {
    super(501, `${feature} is not implemented yet`, "not_implemented");
    this.name = "NotImplementedError";
  }
}
