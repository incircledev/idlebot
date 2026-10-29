import { config as loadEnv } from "dotenv";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

export type AppDb = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { appDb?: AppDb };

/** Supabase Postgres. On Vercel use the transaction pooler URL (port 6543). */
export function getDb(): AppDb {
  if (globalForDb.appDb) return globalForDb.appDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url, max: 5 });
  globalForDb.appDb = drizzle(pool, { schema });
  return globalForDb.appDb;
}
