import type { NextFunction, Request, Response } from "express";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { ZodError } from "zod";
import { HttpError } from "../lib/http-error.js";

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (error instanceof HttpError) {
    res.status(error.statusCode).json({
      error: {
        message: error.message
      }
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        message: "Invalid request body",
        issues: error.issues
      }
    });
    return;
  }

  if (
    error instanceof PrismaClientKnownRequestError &&
    error.code === "P2025"
  ) {
    res.status(404).json({
      error: {
        message: "Resource not found"
      }
    });
    return;
  }

  if (
    error instanceof PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    res.status(409).json({
      error: {
        message: "Resource already exists"
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
