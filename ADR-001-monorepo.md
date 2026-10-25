# ADR-001：IdleBot 仓结构 — monorepo 两应用

- 状态：已采纳（用户 2026-10-25 产研小组确认）
- 背景：Vite 大厅（强客户端）+ Next API（任务状态机/鉴权/中继）；长期要加 webhook、Bot token、CLI/MCP
- 决策：单一 Git 仓 monorepo，**两个应用进程**，不做单 Next 全栈；本轮不着急部署

## 目录（目标）

```
idlebot/
  apps/web/          # Vite + React + TS（现 shared-grok-bot）
  apps/api/          # Next App Router + Better Auth + Postgres（现 Origin 草稿）
  packages/contract/ # 共享类型 + 与 API_CONTRACT.md 对齐的 TS 类型/常量
  API_CONTRACT.md    # 契约权威（现 v1.3）
  pnpm-workspace.yaml / turbo 或 pnpm only — 实现方可选
```

## 边界

| 层 | 职责 | 不做什么 |
|----|------|----------|
| web | 大厅 UI、表单、乐观更新回滚；HTTP + credentials | 领域规则（claim/complete）、明文密码存仓 |
| api | 鉴权、CAS claim、完成幂等、EmailRelay、CORS/trustedOrigins | 大厅渲染、素材管线 |
| contract | TaskStatus、DTO、错误码约定 | 运行时业务 |

## 同域（部署时）

- api：`api.example.com` 或同域 `/api`
- web：静态 CDN 或同域 `/`
- 推荐：Vercel 反代 / 同父域，cookie SameSite=Lax；开发期可用 vite proxy → api

## 非目标

- 合进单一 Next 应用
- 本轮公开发布 / 生产部署（用户明确不着急）
- P1：failed/超时、唤醒 webhook（契约已标）

## 后果

- 一次 PR 可改契约 + 两端；扩展 Agent 入口只动 api
- 迁仓有一次性搬家成本；先迁目录再联调，再谈部署
