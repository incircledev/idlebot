import { config as loadEnv } from "dotenv";
import { neonConfig, Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import ws from "ws";
import * as schema from "./schema";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

neonConfig.webSocketConstructor = ws;

export type AppDb = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { appDb?: AppDb };

function isNeon(url: string) {
  return /neon\.tech/i.test(url) || process.env.DB_DRIVER === "neon";
}

export function getDb(): AppDb {
  if (globalForDb.appDb) return globalForDb.appDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  if (isNeon(url)) {
    const pool = new NeonPool({ connectionString: url });
    globalForDb.appDb = drizzleNeon(pool, { schema }) as unknown as AppDb;
    return globalForDb.appDb;
  }

  const pool = new Pool({ connectionString: url });
  globalForDb.appDb = drizzlePg(pool, { schema });
  return globalForDb.appDb;
}
