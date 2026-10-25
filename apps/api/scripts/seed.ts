import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const accounts = [
  { email: "ada@example.com", password: "password123", name: "Ada" },
  { email: "helper@mail.grokbot.com", password: "password123", name: "Helper" },
];

async function main() {
  const { auth } = await import("../src/lib/auth");
  for (const account of accounts) {
    try {
      await auth.api.signUpEmail({
        body: {
          email: account.email,
          password: account.password,
          name: account.name,
          displayName: account.name,
        },
      });
      console.log(`created ${account.email}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`skipped ${account.email}: ${message}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
