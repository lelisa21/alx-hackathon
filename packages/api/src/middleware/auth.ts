import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { ApiRepository } from "../types.js";
import { sendProblem } from "./problem.js";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function matchesSessionToken(
  expected: string | null,
  actual: string,
): boolean {
  if (!expected) return false;
  const expectedBytes = Buffer.from(expected, "hex");
  const actualBytes = Buffer.from(actual, "hex");
  return (
    expectedBytes.length === actualBytes.length &&
    timingSafeEqual(expectedBytes, actualBytes)
  );
}

export function createSessionAuth(
  repository: Pick<ApiRepository, "getSessionTokenHash" | "touchSession">,
) {
  return async function requireSession(
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> {
    const authorization = request.header("authorization") ?? "";
    const match = /^Bearer ([A-Za-z0-9_-]{20,100})$/u.exec(authorization);
    const sessionId =
      typeof request.body?.sessionId === "string"
        ? request.body.sessionId
        : typeof request.query.sessionId === "string"
          ? request.query.sessionId
          : "";

    const token = match?.[1];
    if (!token || !sessionId) {
      sendProblem(response, 401, "unauthorized", "error.generic");
      return;
    }

    const storedHash = await repository.getSessionTokenHash(sessionId);
    if (!matchesSessionToken(storedHash, sha256(token))) {
      sendProblem(response, 401, "unauthorized", "error.generic");
      return;
    }

    await repository.touchSession(sessionId);
    next();
  };
}
