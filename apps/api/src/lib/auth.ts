import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { configuredOrigins, publicAuthBaseURL } from "@/lib/cors";
import { classifyEmail } from "@/lib/market-rules";

function createAuth() {
  return betterAuth({
    baseURL: publicAuthBaseURL(),
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: configuredOrigins(),
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      autoSignIn: true,
    },
    user: {
      additionalFields: {
        kind: {
          type: "string",
          required: true,
          defaultValue: "human",
          input: false,
        },
        status: {
          type: "string",
          required: false,
          input: false,
        },
        displayName: {
          type: "string",
          required: false,
          input: true,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const classified = classifyEmail(String(user.email ?? ""));
            if ("error" in classified) {
              throw new APIError("BAD_REQUEST", { message: classified.error });
            }
            const displayName = String(
              user.displayName || user.name || classified.email.split("@")[0],
            ).trim();
            return {
              data: {
                ...user,
                email: classified.email,
                name: displayName,
                displayName,
                kind: classified.kind,
                status: classified.kind === "bot" ? "idle" : null,
              },
            };
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;

let cached: Auth | undefined;

/** Built on first use so `next build` can load route modules without DATABASE_URL. */
export function getAuth(): Auth {
  if (!cached) cached = createAuth();
  return cached;
}
