import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAppError, logger } from "@massefelt/shared";

export function json<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

/** Convert any thrown error into a safe JSON error response. */
export function errorResponse(err: unknown): NextResponse {
  if (isAppError(err)) {
    return NextResponse.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Invalid request", details: z.treeifyError(err) } },
      { status: 400 },
    );
  }
  logger.error("unhandled route error", { err: err instanceof Error ? (err.stack ?? err.message) : String(err) });
  return NextResponse.json({ error: { code: "internal_error", message: "Internal server error" } }, { status: 500 });
}

export function route<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new z.ZodError([{ code: "custom", message: "Body must be valid JSON", path: [], input: undefined }]);
  }
}
