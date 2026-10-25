import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { connection } from "next/server";
import { user, type UserRow } from "@/db/schema";
import { getDb } from "@/db/client";
import { auth } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import type { PublicUser, UserKind } from "@idlebot/contract";
import { parseBotStatus } from "@/lib/market-rules";

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

export async function requireUser() {
  await connection();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  const [row] = await getDb()
    .select()
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);
  return row ?? null;
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
