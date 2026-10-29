import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { ApiKeyInfo, ApiKeyIssued } from "@idlebot/contract";
import { apiKey, user, type UserRow } from "@/db/schema";
import { getDb } from "@/db/client";
import { HttpError } from "@/lib/http";

export const API_KEY_PREFIX = "idb_";

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export function looksLikeApiKey(token: string) {
  return token.startsWith(API_KEY_PREFIX);
}

/** Profile for a live key, or null for an unknown or revoked one. */
export async function userForApiKey(key: string): Promise<UserRow | null> {
  const [row] = await getDb()
    .select({ user })
    .from(apiKey)
    .innerJoin(user, eq(apiKey.userId, user.id))
    .where(and(eq(apiKey.keyHash, hashKey(key)), isNull(apiKey.revokedAt)))
    .limit(1);
  return row?.user ?? null;
}

function requireBot(owner: UserRow) {
  if (owner.kind !== "bot") throw new HttpError(403, "Only bot accounts can hold API keys");
}

/** Revokes the bot's live key, if any, and issues a new one. The plain key is only returned here. */
export async function issueApiKey(owner: UserRow): Promise<ApiKeyIssued> {
  requireBot(owner);
  const key = API_KEY_PREFIX + randomBytes(32).toString("base64url");
  const prefix = key.slice(0, 12);
  const now = new Date();
  const [created] = await getDb().transaction(async (tx) => {
    await tx
      .update(apiKey)
      .set({ revokedAt: now })
      .where(and(eq(apiKey.userId, owner.id), isNull(apiKey.revokedAt)));
    return tx
      .insert(apiKey)
      .values({ userId: owner.id, keyHash: hashKey(key), prefix, createdAt: now })
      .returning();
  });
  return { key, prefix, createdAt: created.createdAt.toISOString() };
}

export async function revokeApiKey(owner: UserRow) {
  requireBot(owner);
  const revoked = await getDb()
    .update(apiKey)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKey.userId, owner.id), isNull(apiKey.revokedAt)))
    .returning({ id: apiKey.id });
  return { revoked: revoked.length };
}

export async function apiKeyInfo(owner: UserRow): Promise<ApiKeyInfo> {
  requireBot(owner);
  const [live] = await getDb()
    .select()
    .from(apiKey)
    .where(and(eq(apiKey.userId, owner.id), isNull(apiKey.revokedAt)))
    .limit(1);
  return {
    active: live ? { prefix: live.prefix, createdAt: live.createdAt.toISOString() } : null,
  };
}
