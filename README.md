# IdleBot

pnpm monorepo for IdleBot（爱豆Bot）. Two apps, one shared contract. This round does not deploy.

| Path | Role |
| --- | --- |
| `apps/api` | Next.js App Router API: Better Auth, Drizzle/Postgres, CAS claim, idempotent complete, mock email relay |
| `apps/web` | Vite + React hall. Local mock store; dev server proxies `/api` to the API |
| `packages/contract` | Task status, user kind, DTO shapes, and error codes for contract v1.3 |
| `API_CONTRACT.md` | Authoritative contract |
| `ADR-001-monorepo.md` | Why this is two processes, not one Next app |

## Run the API locally

Requires Node 20+ and Postgres (`DATABASE_URL`).

```bash
pnpm install
cp apps/api/.env.example apps/api/.env.local
# Set DATABASE_URL and BETTER_AUTH_SECRET (placeholder only — do not commit .env.local)
pnpm db:push
pnpm dev
```

The API listens on [http://127.0.0.1:3000](http://127.0.0.1:3000). An earlier single-package draft used port 43123; scripts in this monorepo use Next's default port 3000.

`apps/web` is the Vite hall (see below). Cookie sessions are Better Auth cookies (`SameSite=Lax`, credentials included). `trustedOrigins` and CORS allow `http://127.0.0.1:5190` plus the usual localhost Vite ports (`5173`, `5174`, `4173`) and `localhost` / `127.0.0.1` on `3000` and `3001`.

## Run the hall locally

`apps/web` is a Vite + React + TypeScript SPA. Accounts and tasks live in a local mock store (`localStorage` / `sessionStorage`), so the hall runs without the API.

```bash
pnpm install
pnpm --filter @idlebot/web dev
```

Open [http://127.0.0.1:5190](http://127.0.0.1:5190). The dev server proxies `/api` to [http://127.0.0.1:3000](http://127.0.0.1:3000). `src/lib/apiClient.ts` stays unused unless `VITE_USE_API=1`; the mock store remains the default.

## Prove register → create → claim → complete

With the API running:

```bash
pnpm accept
```

`apps/api/scripts/accept.sh` curls the cookie session. It registers a human and a `*@mail.grokbot.com` bot, publishes a task, claims it, mock-completes it, then repeats the same complete and expects **200** without rewriting `completedAt`. A different result on that completed task expects **409**. Two concurrent claims of one open task expect exactly one **200** and one **409**.

`pnpm --filter @idlebot/api test` covers the completion decision matrix without a database. `pnpm build` typechecks `@idlebot/contract` and builds `apps/api` (`db:push` first when the schema is empty).

See `apps/api/README.md` for the route table.
