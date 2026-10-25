import { eq } from "drizzle-orm";
import { user } from "@/db/schema";
import { getDb } from "@/db/client";
import { getAuth } from "@/lib/auth";
import { applyCors } from "@/lib/cors";
import { HttpError, json } from "@/lib/http";
import { classifyEmail } from "@/lib/market-rules";
import { toPublicUser } from "@/lib/users";
import { NextResponse } from "next/server";

type AuthBody = {
  email?: unknown;
  password?: unknown;
  name?: unknown;
  displayName?: unknown;
  kind?: unknown;
};

function asRecord(value: unknown): AuthBody {
  if (!value || typeof value !== "object") {
    throw new HttpError(400, "Invalid JSON body");
  }
  return value as AuthBody;
}

function passwordOf(body: AuthBody) {
  if (typeof body.password !== "string") {
    throw new HttpError(400, "password is required");
  }
  if (body.password.length < 8 || body.password.length > 128) {
    throw new HttpError(400, "Password must be 8 to 128 characters");
  }
  return body.password;
}

async function publicUserByEmail(email: string) {
  const [row] = await getDb().select().from(user).where(eq(user.email, email)).limit(1);
  if (!row) throw new HttpError(500, "User was not stored");
  return toPublicUser(row);
}

function withUpstreamCookies(upstream: Response, body: unknown, status: number, request: Request) {
  const headers = new Headers();
  for (const cookie of upstream.headers.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }
  applyCors(headers, request);
  return NextResponse.json(body, { status, headers });
}

async function upstreamError(upstream: Response, request: Request, fallback: string) {
  let message = fallback;
  try {
    const payload = (await upstream.json()) as { message?: string; error?: string };
    message = payload.message || payload.error || fallback;
  } catch {
    message = fallback;
  }
  return json({ error: message }, upstream.status, request);
}

export async function registerWithPassword(request: Request) {
  const body = asRecord(await request.json().catch(() => {
    throw new HttpError(400, "Invalid JSON body");
  }));
  if (typeof body.email !== "string") throw new HttpError(400, "email is required");
  const classified = classifyEmail(body.email);
  if ("error" in classified) throw new HttpError(400, classified.error);
  if (body.kind !== undefined && body.kind !== classified.kind) {
    throw new HttpError(400, "kind does not match the email domain");
  }
  const password = passwordOf(body);
  const displayName =
    (typeof body.displayName === "string" && body.displayName.trim()) ||
    (typeof body.name === "string" && body.name.trim()) ||
    classified.email.split("@")[0];

  const upstream = await getAuth().api.signUpEmail({
    body: {
      email: classified.email,
      password,
      name: displayName,
      displayName,
    },
    headers: request.headers,
    asResponse: true,
  });
  if (!upstream.ok) return upstreamError(upstream, request, "Could not register");
  const publicUser = await publicUserByEmail(classified.email);
  return withUpstreamCookies(upstream, { user: publicUser }, 201, request);
}

export async function loginWithPassword(request: Request) {
  const body = asRecord(await request.json().catch(() => {
    throw new HttpError(400, "Invalid JSON body");
  }));
  if (typeof body.email !== "string") throw new HttpError(400, "email is required");
  const classified = classifyEmail(body.email);
  if ("error" in classified) throw new HttpError(400, classified.error);
  const password = passwordOf(body);
  const upstream = await getAuth().api.signInEmail({
    body: { email: classified.email, password },
    headers: request.headers,
    asResponse: true,
  });
  if (!upstream.ok) return upstreamError(upstream, request, "Could not sign in");
  const publicUser = await publicUserByEmail(classified.email);
  return withUpstreamCookies(upstream, { user: publicUser }, 200, request);
}
