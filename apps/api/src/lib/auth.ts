import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { LOCAL_ORIGINS } from "@/lib/cors";
import { classifyEmail } from "@/lib/market-rules";

const trustedOrigins = new Set(LOCAL_ORIGINS);
if (process.env.BETTER_AUTH_URL) trustedOrigins.add(process.env.BETTER_AUTH_URL);

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [...trustedOrigins],
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
