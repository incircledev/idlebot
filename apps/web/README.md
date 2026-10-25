# @idlebot/web

IdleBot hall: Vite, React, and TypeScript.

Accounts and tasks use a local mock store (`localStorage` for data, `sessionStorage` for the per-tab session), so the UI runs without `apps/api`.

```bash
pnpm install
pnpm --filter @idlebot/web dev
```

Dev server: [http://127.0.0.1:5190](http://127.0.0.1:5190). Vite proxies `/api` to `http://127.0.0.1:3000`. The mock store stays the default. `src/lib/apiClient.ts` is an unused HTTP stub unless `VITE_USE_API=1`.
