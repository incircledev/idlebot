export type OriginEnv = {
  BETTER_AUTH_URL?: string;
  VERCEL_ENV?: string;
  VERCEL_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  VERCEL_BRANCH_URL?: string;
  TRUSTED_ORIGINS?: string;
};

export const LOCAL_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:4173",
  "http://localhost:5190",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:4173",
  "http://127.0.0.1:5190",
  "http://localhost:43123",
  "http://127.0.0.1:43123",
];

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[, \n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function originOf(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null") return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return null;
  }
}

function addConfiguredOrigin(origins: Set<string>, value: string | undefined) {
  if (!value) return;
  const trimmed = value.trim();
  if (!trimmed) return;
  if (trimmed.includes("*")) {
    origins.add(trimmed);
    return;
  }
  const origin = originOf(trimmed);
  if (origin) origins.add(origin);
}

function currentOriginEnv(): OriginEnv {
  return {
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_URL: process.env.VERCEL_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    VERCEL_BRANCH_URL: process.env.VERCEL_BRANCH_URL,
    TRUSTED_ORIGINS: process.env.TRUSTED_ORIGINS,
  };
}

/** Local dev origins, plus the Vercel deployment and any extra origins from env. */
export function configuredOrigins(env: OriginEnv = currentOriginEnv()): string[] {
  const origins = new Set<string>(LOCAL_ORIGINS);
  for (const candidate of [
    env.BETTER_AUTH_URL,
    env.VERCEL_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL,
    env.VERCEL_BRANCH_URL,
    ...splitList(env.TRUSTED_ORIGINS),
  ]) {
    addConfiguredOrigin(origins, candidate);
  }
  return [...origins];
}

/**
 * Public origin Better Auth should treat as this process.
 * Preview deployments each have their own host, so a production BETTER_AUTH_URL
 * must not become the preview base URL.
 */
export function publicAuthBaseURL(env: OriginEnv = currentOriginEnv()): string | undefined {
  if (env.VERCEL_ENV === "preview") {
    const preview = originOf(env.VERCEL_URL);
    if (preview) return preview;
  }
  return originOf(env.BETTER_AUTH_URL) ?? originOf(env.VERCEL_URL) ?? undefined;
}

export function allowedOrigin(origin: string | null, env: OriginEnv = currentOriginEnv()) {
  if (!origin || origin === "null") return null;
  const normalized = originOf(origin);
  if (!normalized) return null;
  return configuredOrigins(env).includes(normalized) ? normalized : null;
}

export function applyCors(headers: Headers, request?: Request) {
  const origin = allowedOrigin(request?.headers.get("origin") ?? null);
  if (!origin) return;
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Vary", "Origin");
}
