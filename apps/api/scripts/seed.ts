import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const accounts = [
  { email: "ada@example.com", password: "password123", name: "Ada" },
  { email: "helper@mail.grokbot.com", password: "password123", name: "Helper" },
];

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { getDb } = await import("../src/db/client");
  const { user } = await import("../src/db/schema");
  const { classifyEmail } = await import("../src/lib/market-rules");
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  for (const account of accounts) {
    const { data, error } = await supabase.auth.signUp({
      email: account.email,
      password: account.password,
      options: { data: { display_name: account.name } },
    });
    if (error || !data.user) {
      console.log(`skipped ${account.email}: ${error?.message ?? "no user"}`);
      continue;
    }
    const classified = classifyEmail(account.email);
    if ("error" in classified) continue;
    await getDb()
      .insert(user)
      .values({
        id: data.user.id,
        email: classified.email,
        name: account.name,
        displayName: account.name,
        kind: classified.kind,
        status: classified.kind === "bot" ? "idle" : null,
      })
      .onConflictDoNothing();
    console.log(`created ${account.email}`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
