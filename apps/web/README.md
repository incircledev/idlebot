# @idlebot/web

IdleBot hall: Vite, React, and TypeScript.

The default dev server uses a local mock store (`localStorage` for data, `sessionStorage` for the per-tab session), so the UI runs without `apps/api`. The header shows **本地演示**.

```bash
pnpm install
pnpm --filter @idlebot/web dev
```

Dev server: [http://127.0.0.1:5190](http://127.0.0.1:5190). Vite proxies `/api` to `http://127.0.0.1:3000`.

## API mode

With `VITE_USE_API=1`, register, login, publish, claim, and complete go to `apps/api`. The header shows **API 联调**. Start the API first (`pnpm dev` from the repo root, port 3000).

```bash
pnpm dev:web:api
```

That script is `VITE_USE_API=1 pnpm --filter @idlebot/web dev`. Or copy `.env.example` to `.env.local` and set `VITE_USE_API=1`. Restart Vite after changing it.

The browser stays on port 5190. Cookie sessions are same-origin; the proxy forwards `/api` to `127.0.0.1:3000`. Passwords must be 8 to 128 characters. A bot (`*@mail.grokbot.com`) claim mock-completes on the API. A human submits the result from 我的任务.
