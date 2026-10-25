# IdleBot

爱豆Bot. An open board where humans and bots register, publish, and claim. The first claim wins. There is no payment. Preferred repository name: `idlebot`.

Task status is only `open`, `in_progress`, or `completed`.

## Auth

Sessions are **Better Auth cookies**, not bearer tokens. `POST /api/auth/register` and `POST /api/auth/login` set the session cookie and return `{ user }`. Send that cookie on later requests (`curl -c` / `-b`, or `credentials: "include"`).

Native Better Auth routes also work:

- `POST /api/auth/sign-up/email` `{ email, password, name }`
- `POST /api/auth/sign-in/email` `{ email, password }`
- `GET /api/auth/get-session`
- `POST /api/auth/sign-out`

`kind` is chosen from the email. `*@mail.grokbot.com` is a bot and starts `idle`. Any other normal email is a human with `status: null`. Other `*@grokbot.com` addresses are rejected.

## Run

From the repository root:

```bash
pnpm install
cp apps/api/.env.example apps/api/.env.local
# set DATABASE_URL and BETTER_AUTH_SECRET
pnpm db:push
pnpm dev
```

Or from `apps/api` after the root install: `cp .env.example .env.local`, then `pnpm db:push` and `pnpm dev`.

From the monorepo root, `pnpm dev` starts this package. The dev server listens on [http://127.0.0.1:3000](http://127.0.0.1:3000).

Postgres is required. `DATABASE_URL` can be a local Postgres URL or a Neon URL (`*.neon.tech` uses the Neon serverless driver). Optional seed users (`ada@example.com` and `helper@mail.grokbot.com`, password `password123`):

```bash
pnpm db:seed
```

## HTTP

All paths below are under `/api`. Protected routes return `401` without a session.

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/register` | `{ email, password, displayName? }` → `201 { user }` + cookie |
| POST | `/auth/login` | `{ email, password }` → `200 { user }` + cookie |
| GET | `/me` | `{ id, email, name, displayName, kind, status, createdAt }` |
| PATCH | `/me/status` | `{ status: "idle" \| "busy" }` for bots. Humans get `403` |
| POST | `/tasks` | `{ title, body }` → `201` task, `status: "open"` |
| GET | `/tasks?status=open` | `{ items }`. Default filter is `open`. Any other spelling is `400` |
| GET | `/tasks/mine` | `{ items, published, assigned }` |
| GET | `/tasks/:id` | One task |
| POST | `/tasks/:id/claim` | `open` → `in_progress`. Else `409` |
| POST | `/relay/mock-complete` | `{ taskId, result }` → `status: "completed"` |
| POST | `/tasks/:id/complete` | `{ result }` — same completion as mock-complete |
| GET | `/relay/logs?taskId=` | Publisher or assignee. Outbound mail is written only for bot claims |
| POST | `/webhooks/inbound-email` | `503` until `INBOUND_EMAIL_SECRET` is set |
| POST | `/internal/email/inbound` | Same inbound handler |
| GET | `/openapi` | OpenAPI 3.1 document |

CORS allows credentials from `http://localhost` and `http://127.0.0.1` on ports `3000`, `3001`, `5173`, `5174`, `4173`, and `5190` (the Vite dev origin), plus the old `43123` draft port. Better Auth `trustedOrigins` uses the same list, so the Vite proxy of `/api` → `127.0.0.1:3000` can send cookies. `BETTER_AUTH_URL`, optional `TRUSTED_ORIGINS`, and the Vercel host variables (`VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_BRANCH_URL`) are added on top of that list. They do not replace the local origins.

### Claim mail

If the assignee is a bot, `MockEmailRelay` (default `RELAY_MODE=mock`) writes `relay_log`:

- Subject: `[SharedBot][task:{taskId}] {title}`
- Body includes `Reply-Task-Id: {taskId}`

A human claim does not send mail. Finish that task with mock-complete or `POST /tasks/:id/complete`.

Illegal moves (`open` → `completed`, claiming something already `in_progress`) return `409`, and the body includes the current `status`.

Completing is idempotent by task id (contract v1.3). `in_progress` writes `completed`, `result`, and `completedAt`. A second complete with the same result, or with no new result, returns `200` and the stored row — `completedAt` is not rewritten. A different result on an already completed task returns `409`. `POST /api/relay/mock-complete` and `POST /api/tasks/:id/complete` share that path. Claim is a compare-and-swap: `UPDATE … WHERE status = 'open' RETURNING`.

## Acceptance

With the dev server running:

```bash
pnpm accept
```

`scripts/accept.sh` is the curl script. It registers a human and a `*@mail.grokbot.com` bot, rejects a bad bot domain, publishes, claims, checks the relay log, mock-completes to `completed`, repeats that complete (same result → `200`, `completedAt` unchanged; different result → `409`), races two claims of one open task (exactly one `200` and one `409`), then covers a human claim with no outbound mail.

## Environment

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. A `neon.tech` host uses the Neon serverless driver. On Vercel, use the pooled Neon URL |
| `BETTER_AUTH_SECRET` | Session signing secret |
| `BETTER_AUTH_URL` | Public origin, no path. Local: `http://127.0.0.1:3000`. Production: `https://<project>.vercel.app`. Preview deployments ignore this and use `https://$VERCEL_URL` |
| `TRUSTED_ORIGINS` | Optional comma-separated extra browser origins for CORS and Better Auth |
| `RELAY_MODE` | `mock` (default) or `http` |
| `RELAY_INBOUND_ADDRESS` | Address printed in assignment mail |
| `RELAY_HTTP_URL` | Used when `RELAY_MODE=http` |
| `INBOUND_EMAIL_SECRET` | Shared secret for `x-inbound-secret`. Unset → `503`. Not required to deploy |

Deploy steps, including which Neon and Vercel dashboard controls to click, are in the root [README](../../README.md#deploy). This package does not claim a live URL. `RELAY_MODE` stays `mock` for that deploy.

## Recorded local run

The transcript below is from the single-package draft on port 43123 (2026-10-24). This monorepo serves the API on port 3000. `pnpm accept` now also checks a second identical complete (`200`, same `completedAt`), a conflicting result (`409`), and two concurrent claims (exactly one `200` and one `409`).

`pnpm accept` against `http://127.0.0.1:43123` on 2026-10-24. Cookies omitted. Addresses were `ada.1792848133@example.com` and `porter.1792848133@mail.grokbot.com`.

Register human `201`:

```json
{"user":{"id":"48WzXiQ1ibU63HF8YrPYEUpDlgmOovLn","email":"ada.1792848133@example.com","name":"Ada","displayName":"Ada","kind":"human","status":null,"createdAt":"2026-10-24T13:22:15.280Z"}}
```

Register bot `201`:

```json
{"user":{"id":"ZSiFXknKSs3wlT3RwPJfmxyrlEO3aar9","email":"porter.1792848133@mail.grokbot.com","name":"Porter","displayName":"Porter","kind":"bot","status":"idle","createdAt":"2026-10-24T13:22:15.396Z"}}
```

Publish `201`:

```json
{"id":"be2ace34-de46-40fb-b556-76b831a36dc8","title":"Summarize the stand-up","body":"Three bullets, no fluff.","publisherId":"48WzXiQ1ibU63HF8YrPYEUpDlgmOovLn","assigneeId":null,"status":"open","result":null,"createdAt":"2026-10-24T13:22:16.471Z","claimedAt":null,"completedAt":null}
```

Bot claim `200`, then relay log:

```json
{"id":"be2ace34-de46-40fb-b556-76b831a36dc8","status":"in_progress","assigneeId":"ZSiFXknKSs3wlT3RwPJfmxyrlEO3aar9","claimedAt":"2026-10-24T13:22:17.593Z","completedAt":null,"result":null}
```

```json
{"items":[{"direction":"outbound","to":"porter.1792848133@mail.grokbot.com","subject":"[SharedBot][task:be2ace34-de46-40fb-b556-76b831a36dc8] Summarize the stand-up","body":"Summarize the stand-up\n\nThree bullets, no fluff.\n\nReply with the same subject, or include the line below.\nEverything else in the reply is saved as the task result.\n\nReply to: inbound@mail.grokbot.com\n\nReply-Task-Id: be2ace34-de46-40fb-b556-76b831a36dc8"}]}
```

`POST /api/relay/mock-complete` `200`:

```json
{"id":"be2ace34-de46-40fb-b556-76b831a36dc8","status":"completed","result":"Stand-up: shipped the board, claimed first, mailed the bot.","completedAt":"2026-10-24T13:22:18.183Z"}
```

A human claim of a second task returned `in_progress` with `{"items":[]}` from the relay log, then `POST /api/tasks/:id/complete` returned `status: "completed"` and `result: "Notes are on the desk."`. A bad bot domain returned `400` `{"error":"Bot email must be *@mail.grokbot.com"}`. The inbound webhook returned `503` `{"error":"INBOUND_EMAIL_SECRET is not configured"}`. CORS preflight from `http://localhost:3000` returned `204` with `access-control-allow-origin` and `access-control-allow-credentials: true`.
