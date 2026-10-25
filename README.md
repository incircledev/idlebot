# IdleBot

pnpm monorepo for IdleBot（爱豆Bot）. Two apps, one shared contract. Deploy scaffold is in [DEPLOY / 环境变量](#deploy). Nothing here is a live URL.

| Path | Role |
| --- | --- |
| `apps/api` | Next.js App Router API: Better Auth, Drizzle/Postgres, CAS claim, idempotent complete, mock email relay |
| `apps/web` | Vite + React hall. Dev mock unless `VITE_USE_API=1`. Production build calls same-origin `/api` |
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

`apps/web` is a Vite + React + TypeScript SPA. With the flag unset, accounts and tasks live in a local mock store (`localStorage` / `sessionStorage`), so the hall runs without the API.

```bash
pnpm install
pnpm --filter @idlebot/web dev
```

Open [http://127.0.0.1:5190](http://127.0.0.1:5190). The dev server proxies `/api` to [http://127.0.0.1:3000](http://127.0.0.1:3000). The header shows **本地演示**.

## Run the hall against the API

`VITE_USE_API=1` sends register, login, publish, claim, and complete to `apps/api`. The mock store stays unused. The header shows **API 联调**.

```bash
# terminal 1 — API on http://127.0.0.1:3000
pnpm dev

# terminal 2 — hall on http://127.0.0.1:5190
pnpm dev:web:api
```

`pnpm dev:web:api` is `VITE_USE_API=1 pnpm --filter @idlebot/web dev`. A copy of `apps/web/.env.example` to `apps/web/.env.local` with `VITE_USE_API=1` does the same thing. Restart Vite after changing the flag.

The browser talks only to port 5190. Vite proxies `/api` to `http://127.0.0.1:3000`, so the Better Auth cookie stays on the hall origin (`credentials: include`). The API already trusts `http://127.0.0.1:5190`.

Passwords are 8 to 128 characters. `*@mail.grokbot.com` registers as a bot; any other normal email is a human. A bot claim calls `POST /api/relay/mock-complete` and lands on `completed` with a readable result. A human claim stays `in_progress` until **提交结果**, which calls `POST /api/tasks/:id/complete`. Sign out calls `POST /api/auth/sign-out`.

## Prove register → create → claim → complete

With the API running:

```bash
pnpm accept
```

`apps/api/scripts/accept.sh` curls the cookie session. It registers a human and a `*@mail.grokbot.com` bot, publishes a task, claims it, mock-completes it, then repeats the same complete and expects **200** without rewriting `completedAt`. A different result on that completed task expects **409**. Two concurrent claims of one open task expect exactly one **200** and one **409**.

`pnpm --filter @idlebot/api test` covers the completion decision matrix and origin checks without a database. `pnpm build` typechecks `@idlebot/contract` and builds `apps/api` and `apps/web` without opening Postgres. The web production bundle talks to `/api`. Run `pnpm db:push` before the API serves traffic if the schema is empty.

See `apps/api/README.md` for the route table.

## <a id="deploy"></a>DEPLOY / 环境变量

一个 Vercel Hobby 项目同时托管大厅和 API（[Vercel Services](https://vercel.com/docs/services)，Beta，全套餐可用）。浏览器只访问一个 `*.vercel.app`，Better Auth cookie 用 `SameSite=Lax`。自定义域名以后再加。

| 公网路径 | 服务 | 产物 |
| --- | --- | --- |
| `/` | `apps/web`（Vite） | 静态 `dist`。生产构建请求同站 `/api` |
| `/api` | `apps/api`（Next.js Route Handlers） | Better Auth、任务、mock 中继 |

`apps/api` 里的 Market Desk 仍会随 API 一起构建，但公网 `/` 不再打开它。首页是大厅。

配置在仓库根 `vercel.json`。本地开发不变：大厅 `http://127.0.0.1:5190` 代理 `/api` 到 `http://127.0.0.1:3000`。这次变更不部署，也没有线上地址。Neon 和 Vercel 的点击要在你自己的账号里做。

### 你要点的地方

1. **Neon 数据库**
   - 打开 [Neon Console](https://console.neon.tech) → **New project**。名字例如 `idlebot`。Region 选 **AWS US East (N. Virginia)**，靠近 Vercel 函数默认区 `iad1`。
   - 进入项目 → **Connect**（或 **Dashboard** 上的连接串）→ 勾上 **Connection pooling** → 复制 **Pooled connection**。主机名里应有 `-pooler`。这就是 `DATABASE_URL`。
   - 另一条路：Vercel 项目里 **Storage**（或 **Integrations**）→ **Browse Marketplace** → **Neon** → **Install** → 创建数据库。Marketplace 会把 `DATABASE_URL` 写进这个 Vercel 项目。两条路选一条。
2. **Vercel 项目（Hobby）**
   - 打开 [Add New → Project](https://vercel.com/new) → 在 **Import Git Repository** 里选这个 GitHub 仓库 → **Import**。
   - **Root Directory** 留空，或保持仓库根。不要选 `apps/web`，也不要选 `apps/api`。向导如果猜了一个 Next.js 根目录，点 **Edit** 改回去。Framework 预设可以忽略：以提交的 `vercel.json` 里的 `services` 为准。
   - 展开 **Environment Variables**，按下面的表填写，然后点 **Deploy**。
   - 构建成功后，**Project → Settings → Domains** 里能看到 `https://<项目名>.vercel.app`。若和你填的 `BETTER_AUTH_URL` 不一致，改环境变量后再 **Deployments → Redeploy**。
3. **建表**（你的电脑，对着 Neon，不是本地 Postgres）

```bash
cp apps/api/.env.example apps/api/.env.local
# DATABASE_URL=Neon 的 pooled URL
# BETTER_AUTH_SECRET=与 Vercel 上相同的值
pnpm db:push
```

大厅注册之前必须有表。不要设置 `INBOUND_EMAIL_SECRET`。`RELAY_MODE` 保持 `mock`。

### 环境变量

在 Vercel 的 **Settings → Environment Variables** 里填。Production 和 Preview 都要有密钥和数据库，除非表里另写。

| 名字 | 环境 | 作用 |
| --- | --- | --- |
| `DATABASE_URL` | Production、Preview | Neon pooled URL。主机名含 `neon.tech` 时走已接入的 `@neondatabase/serverless`。 |
| `BETTER_AUTH_SECRET` | Production、Preview | `openssl rand -base64 32`。不要提交到 git。 |
| `BETTER_AUTH_URL` | 只填 Production | 站点源，无路径，例如 `https://idlebot.vercel.app`。Preview 留空：该次部署用 `https://$VERCEL_URL` 做 Better Auth base URL。 |
| `RELAY_MODE` | Production、Preview | `mock`。不设也是 mock。这次不要改成真实发信。 |
| `TRUSTED_ORIGINS` | 可选 | 逗号分隔的额外浏览器源。本地端口（含 `http://127.0.0.1:5190`）始终允许。平台注入的 `VERCEL_URL`、`VERCEL_PROJECT_PRODUCTION_URL`、`VERCEL_BRANCH_URL` 会自动加入 CORS 和 `trustedOrigins`。不要自己设置这些 `VERCEL_*`。 |
| `VITE_USE_API` | 构建期，一般不用在面板里设 | `vercel.json` 的 web `buildCommand` 已加上 `VITE_USE_API=1`。生产包请求同站 `/api`。只有设成 `0` 才会打出纯 mock 静态站。`pnpm dev` 默认仍是 mock。 |

不需要 Resend、OTP、`INBOUND_EMAIL_SECRET`，也不需要自定义域名。以后加域名时，在 Vercel **Domains** 里添加，并把 Production 的 `BETTER_AUTH_URL` 改成那个 `https://` 源，然后 Redeploy。

### Vercel 实际执行的构建

每个 service 各自安装依赖、各自构建。命令在 `vercel.json`，工作目录先回到仓库根，这样 pnpm workspace 找得到 lockfile：

- web：`VITE_USE_API=1 pnpm --filter @idlebot/web build`，输出 `apps/web/dist`。未知路径回落到 `index.html`。
- api：`pnpm --filter @idlebot/api build`（`next build`）。

本地证明用 `pnpm build`（contract 类型检查 + api + web，不需要 `DATABASE_URL`）。web 的 production build 默认连 `/api`。开发仍是 `pnpm dev` 与 `pnpm dev:web:api`。

Better Auth 在第一次请求时才连接数据库，所以构建本身不跑 `db:push`。表要你在 Neon 上自己推。

如果 Vercel 拒绝 `services` 这个键（它还在 Beta），不要先拆成两个项目。生产大厅只请求相对路径 `/api`，拆开之后 cookie 会跨站。把构建日志留下来再改配置。
