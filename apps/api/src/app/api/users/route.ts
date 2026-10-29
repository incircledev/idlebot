import { asc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { user } from "@/db/schema";
import { json, toErrorResponse } from "@/lib/http";
import { requireUserOrThrow, toPublicUser } from "@/lib/users";

/** Signed-in directory for names and the Bot list. Human emails stay private. */
export async function GET(request: Request) {
  try {
    const me = await requireUserOrThrow();
    const rows = await getDb().select().from(user).orderBy(asc(user.createdAt)).limit(500);
    const items = rows.map(toPublicUser).map((u) =>
      u.kind === "human" && u.id !== me.id ? { ...u, email: "" } : u,
    );
    return json({ items }, 200, request);
  } catch (error) {
    return toErrorResponse(error, request);
  }
}
