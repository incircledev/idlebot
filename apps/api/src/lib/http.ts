import { errorCodeForStatus, ERROR_CODES, type ErrorCode, type TaskStatus } from "@idlebot/contract";
import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { applyCors } from "./cors";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public taskStatus?: TaskStatus | string,
    public code?: ErrorCode,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200, request?: Request) {
  const headers = new Headers();
  applyCors(headers, request);
  return NextResponse.json(data, { status, headers });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

export function toErrorResponse(error: unknown, request?: Request) {
  unstable_rethrow(error);
  if (error instanceof HttpError) {
    return json(
      {
        error: error.message,
        code: error.code ?? errorCodeForStatus(error.status),
        ...(error.taskStatus ? { status: error.taskStatus } : {}),
      },
      error.status,
      request,
    );
  }
  console.error(error);
  return json({ error: "Internal error", code: ERROR_CODES.INTERNAL }, 500, request);
}
