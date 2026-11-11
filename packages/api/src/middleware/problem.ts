import type { ErrorRequestHandler, Response } from "express";
import { ZodError } from "zod";
import { ProblemSchema } from "../schemas.js";

export type ProblemCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "payload_too_large"
  | "internal";

export function sendProblem(
  response: Response,
  status: number,
  code: ProblemCode,
  messageKey: string,
): void {
  const body = ProblemSchema.parse({
    type: "about:blank",
    title: code,
    status,
    code,
    messageKey,
  });
  response.status(status).type("application/problem+json").json(body);
}

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  request,
  response,
  _next,
) => {
  void _next;
  if (error instanceof ZodError) {
    sendProblem(response, 400, "invalid_request", "error.invalid");
    return;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.too.large"
  ) {
    sendProblem(response, 413, "payload_too_large", "error.too_long");
    return;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.parse.failed"
  ) {
    sendProblem(response, 400, "invalid_request", "error.invalid");
    return;
  }

  request.log?.error(
    {
      code:
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined,
    },
    "unhandled request error",
  );
  sendProblem(response, 500, "internal", "error.generic");
};
