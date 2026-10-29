import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { connection } from "next/server";
import { user, type UserRow } from "@/db/schema";
import { getDb } from "@/db/client";
import { HttpError } from "@/lib/http";
import type { PublicUser, UserKind } from "@idlebot/contract";
import { classifyEmail, parseBotStatus } from "@/lib/market-rules";
import { cookieSupabase, plainSupabase } from "@/lib/supabase";
import { looksLikeApiKey, userForApiKey } from "@/lib/api-keys";

export type { PublicUser };

export function toPublicUser(row: UserRow): PublicUser {
  const kind: UserKind = row.kind === "bot" ? "bot" : "human";
  const status =
    kind === "bot" && (row.status === "idle" || row.status === "busy")
      ? row.status
      : kind === "bot"
        ? "idle"
        : null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    displayName: row.displayName || row.name,
    kind,
    status,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Profile row for a Supabase user. Kind comes from the email domain, never from input. */
export async function ensureProfile(id: string, rawEmail: string, displayName?: string) {
  const db = getDb();
  const [existing] = await db.select().from(user).where(eq(user.id, id)).limit(1);
  if (existing) return existing;
  const classified = classifyEmail(rawEmail);
  if ("error" in classified) throw new HttpError(403, classified.error);
  const name = (displayName || classified.email.split("@")[0]).trim();
  const [created] = await db
    .insert(user)
    .values({
      id,
      email: classified.email,
      name,
      displayName: name,
      kind: classified.kind,
      status: classified.kind === "bot" ? "idle" : null,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [raced] = await db.select().from(user).where(eq(user.id, id)).limit(1);
  if (!raced) throw new HttpError(500, "Profile was not stored");
  return raced;
}

/** Verified Supabase identity from a Bearer access token or the session cookies. */
async function currentIdentity(bearer: string | undefined) {
  const { data, error } = bearer
    ? await plainSupabase().auth.getClaims(bearer)
    : await (await cookieSupabase()).auth.getClaims();
  if (error || !data?.claims?.sub || !data.claims.email) return null;
  const meta = data.claims.user_metadata as { display_name?: unknown } | undefined;
  return {
    id: data.claims.sub,
    email: String(data.claims.email),
    displayName: typeof meta?.display_name === "string" ? meta.display_name : undefined,
  };
}

export async function requireUser() {
  await connection();
  const auth = (await headers()).get("authorization");
  const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer && looksLikeApiKey(bearer)) return userForApiKey(bearer);
  const identity = await currentIdentity(bearer);
  if (!identity) return null;
  return ensureProfile(identity.id, identity.email, identity.displayName);
}

export async function requireUserOrThrow() {
  const row = await requireUser();
  if (!row) throw new HttpError(401, "Unauthorized");
  return row;
}

export async function updateBotStatus(row: UserRow, rawStatus: unknown) {
  if (row.kind !== "bot") {
    throw new HttpError(403, "Only bots can set idle or busy");
  }
  const status = parseBotStatus(rawStatus);
  if (typeof status !== "string") throw new HttpError(400, status.error);
  const [updated] = await getDb()
    .update(user)
    .set({ status, updatedAt: new Date() })
    .where(eq(user.id, row.id))
    .returning();
  if (!updated) throw new HttpError(404, "User not found");
  return toPublicUser(updated);
}
