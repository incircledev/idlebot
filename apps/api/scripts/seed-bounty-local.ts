/**
 * Local-only fixture for the bounty acceptance run. Inserts three profiles with API keys straight
 * into the database (no Supabase auth calls). Refuses to run against anything but localhost.
 * Writes the test API keys to $OUT (default /tmp/idlebot-bounty-keys.env, mode 600).
 */
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { Client } from "pg";

const url = process.env.DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost):/.test(url)) {
  console.error("Refusing: DATABASE_URL must point at a local database");
  process.exit(1);
}

const people = [
  { key: "PUBLISHER", id: "b0000000-0000-4000-8000-000000000001", email: "xiaolu@example.com", name: "小鹿", kind: "human", wallet: null },
  { key: "BOT01", id: "b0000000-0000-4000-8000-000000000002", email: "bot01@mail.grokbot.com", name: "bot01", kind: "bot", wallet: "0xfea2B3ECf7287c6583DaE820B2a46F8Ef2F18ea2" },
  { key: "BOT02", id: "b0000000-0000-4000-8000-000000000003", email: "bot02@mail.grokbot.com", name: "bot02", kind: "bot", wallet: "0xfea2B3ECf7287c6583DaE820B2a46F8Ef2F18ea2" },
  { key: "NOWALLET", id: "b0000000-0000-4000-8000-000000000004", email: "bot03@mail.grokbot.com", name: "bot03", kind: "bot", wallet: null },
] as const;

async function main() {
  const db = new Client({ connectionString: url });
  await db.connect();
  const lines: string[] = [];
  for (const p of people) {
    await db.query(
      `insert into profiles (id, email, name, display_name, kind, status, wallet_address)
       values ($1,$2,$3,$3,$4,$5,$6)
       on conflict (id) do update set wallet_address = excluded.wallet_address, updated_at = now()`,
      [p.id, p.email, p.name, p.kind, p.kind === "bot" ? "idle" : null, p.wallet],
    );
    const key = "idb_" + randomBytes(32).toString("base64url");
    await db.query("update api_key set revoked_at = now() where user_id = $1 and revoked_at is null", [p.id]);
    await db.query("insert into api_key (user_id, key_hash, prefix) values ($1,$2,$3)", [
      p.id,
      createHash("sha256").update(key).digest("hex"),
      key.slice(0, 12),
    ]);
    lines.push(`KEY_${p.key}=${key}`);
  }
  const out = process.env.OUT ?? "/tmp/idlebot-bounty-keys.env";
  writeFileSync(out, lines.join("\n") + "\n", { mode: 0o600 });
  console.log(`seeded ${people.length} local profiles; test API keys in ${out}`);
  await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
