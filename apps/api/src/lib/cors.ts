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

export function allowedOrigin(origin: string | null) {
  if (!origin) return null;
  return LOCAL_ORIGINS.includes(origin) ? origin : null;
}

export function applyCors(headers: Headers, request?: Request) {
  const origin = allowedOrigin(request?.headers.get("origin") ?? null);
  if (!origin) return;
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Vary", "Origin");
}
