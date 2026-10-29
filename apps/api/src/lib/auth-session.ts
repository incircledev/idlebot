import { applyCors } from "@/lib/cors";
import { HttpError, json } from "@/lib/http";
import { classifyEmail } from "@/lib/market-rules";
import { cookieSupabase } from "@/lib/supabase";
import { ensureProfile, toPublicUser } from "@/lib/users";
import { NextResponse } from "next/server";

type AuthBody = {
  email?: unknown;
  password?: unknown;
  name?: unknown;
  displayName?: unknown;
  kind?: unknown;
};

async function readBody(request: Request): Promise<AuthBody> {
  const value = await request.json().catch(() => {
    throw new HttpError(400, "Invalid JSON body");
  });
  if (!value || typeof value !== "object") throw new HttpError(400, "Invalid JSON body");
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

function emailOf(body: AuthBody) {
  if (typeof body.email !== "string") throw new HttpError(400, "email is required");
  const classified = classifyEmail(body.email);
  if ("error" in classified) throw new HttpError(400, classified.error);
  return classified;
}

function respond(body: unknown, status: number, request: Request) {
  const headers = new Headers();
  applyCors(headers, request);
  return NextResponse.json(body, { status, headers });
}

/** Supabase Auth error -> our status code. 4xx stays 4xx; anything else is 502. */
function authFailure(error: { status?: number; message: string; code?: string }, request: Request) {
  const status = error.status && error.status >= 400 && error.status < 500 ? error.status : 502;
  const mapped = error.code === "user_already_exists" ? 409 : status;
  return json({ error: error.message }, mapped, request);
}

export async function registerWithPassword(request: Request) {
  const body = await readBody(request);
  const classified = emailOf(body);
  if (body.kind !== undefined && body.kind !== classified.kind) {
    throw new HttpError(400, "kind does not match the email domain");
  }
  const password = passwordOf(body);
  const displayName =
    (typeof body.displayName === "string" && body.displayName.trim()) ||
    (typeof body.name === "string" && body.name.trim()) ||
    classified.email.split("@")[0];

  const supabase = await cookieSupabase();
  const { data, error } = await supabase.auth.signUp({
    email: classified.email,
    password,
    options: { data: { display_name: displayName } },
  });
  if (error) return authFailure(error, request);
  if (!data.user) throw new HttpError(502, "Supabase returned no user");
  // Supabase hides "already registered" behind a user with no identities.
  if (data.user.identities && data.user.identities.length === 0) {
    return json({ error: "User already exists" }, 409, request);
  }
  const profile = await ensureProfile(data.user.id, classified.email, displayName);
  if (!data.session) {
    return respond({ user: toPublicUser(profile), needsEmailConfirmation: true }, 202, request);
  }
  return respond({ user: toPublicUser(profile) }, 201, request);
}

export async function loginWithPassword(request: Request) {
  const body = await readBody(request);
  const classified = emailOf(body);
  const password = passwordOf(body);
  const supabase = await cookieSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: classified.email,
    password,
  });
  if (error) return authFailure(error, request);
  const profile = await ensureProfile(data.user.id, classified.email);
  return respond({ user: toPublicUser(profile) }, 200, request);
}

export async function signOut(request: Request) {
  const supabase = await cookieSupabase();
  await supabase.auth.signOut();
  return respond({ success: true }, 200, request);
}
