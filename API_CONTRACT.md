# IdleBot (爱豆Bot) — Backend API Contract v1.3

产品标准任务状态枚举（唯一）：`open` | `in_progress` | `completed`。禁止使用其它完成态拼写。
用户已确认：开放公告板先到先得；human 与 bot 都能发/都能接；bot 仅展示 idle|busy。
前端 mock 对齐：`completed`、`claim`、`mock-complete`。

## 技术选型
- Next.js App Router + TypeScript
- Better Auth email/password + Postgres（DATABASE_URL / Neon）
- EmailRelay 接口；默认 Mock；预留入站
- CORS：本地端口写在 `LOCAL_ORIGINS`（含 Vite `5190`）。同域部署时再信任 `BETTER_AUTH_URL`、Vercel 注入的主机名，以及可选 `TRUSTED_ORIGINS`
- 建议仓名：idlebot（Origin 草稿待用户点头发布）

## 账号
| 字段 | 说明 |
|------|------|
| id | uuid |
| email | 唯一；bot 必须 *@mail.grokbot.com |
| kind | `human` \| `bot`（`@mail.grokbot.com` → bot） |
| name / displayName | |
| status | bot：`idle` \| `busy`；human 可 null |
| createdAt | |

## 任务
| 字段 | 说明 |
|------|------|
| id, title, body | |
| publisherId, assigneeId | |
| status | `open` \| `in_progress` \| `completed` |
| result | 完成后写入 |
| createdAt, claimedAt, completedAt | |

状态机：`open` → `in_progress`（claim）→ `completed`（mock-complete / 入站邮件）。P0 无 cancel/failed（P1）。

示例：
```json
{ "id": "…", "status": "completed", "result": "任务输出文本" }
```

## 并发与幂等（发布前强制验收）

### Claim — CAS 原子领取
- 实现必须等价于：`UPDATE tasks SET status='in_progress', assignee_id=?, claimed_at=? WHERE id=? AND status='open' RETURNING *`
- 成功：200，任务为 `in_progress`，assignee 为 claimer
- 已被领 / 非 open：`409`，body 标明当前 status；禁止读-改-写竞态双领
- 验收：两会话并发 claim 同一 open 任务 → 恰好 1 次 200、1 次 409；库内仅一条 assignee

### Complete — 按 taskId 幂等
- 路径：`POST /relay/mock-complete` 与 `POST /tasks/:id/complete` 同一内部逻辑
- `in_progress` → 写入 `completed` + `result`，200
- 已是 `completed` 且 result 相同（或二次无新 result）：**200**，返回现有任务，不双写、不改 `completedAt`
- 已是 `completed` 且 result 不同：`409`
- 其它 status（如仍 `open`）：`409`
- 验收：对同一 taskId 连续两次 complete（相同 result）→ 两次皆 200、库内一条 completed 记录

## 邮件中继
- claim 且 assignee.kind=bot：Mock 发信 Subject `[SharedBot][task:{taskId}] {title}`，Body 含 `Reply-Task-Id: {taskId}`
- human claim：不发信，用 mock-complete 回写 `status=completed`
- 入站 webhook 预留，与完成同一内部逻辑

## 接口（/api 前缀 OK，README 写清）
- Auth：register/login/session（Better Auth 或 POST /auth/register + /auth/login）
- GET /me；PATCH /me/status {idle|busy}（bot）
- POST /tasks；GET /tasks?status=open；GET /tasks/mine
- POST /tasks/:id/claim
- POST /relay/mock-complete 或 POST /tasks/:id/complete {result}
- POST /internal/email/inbound 或 /webhooks/inbound-email（预留）

## 验收
两账号：注册→发任务→claim→mock-complete→`completed` 且 result 可读；bot 邮箱校验；CORS；README/curl 证据。
另：上节 **Claim CAS**、**Complete 幂等** 必须用并发/重复调用证明（日志或 curl）。

## 变更（v1.3）
- 发布前强制：claim CAS + complete 按 taskId 幂等，写入验收
- 明确双源 cookie / trustedOrigins 为联调风险（部署时配）
- P1（不挡部署）：failed/超时、唤醒 webhook、校验粒度

## 仓结构（ADR-001）
- **已定**：monorepo 两应用（`apps/web` Vite + `apps/api` Next + `packages/contract`）；不做单 Next。
- **本轮**：先迁仓落地联调。部署脚手架见根目录 `vercel.json` 与 README「DEPLOY / 环境变量」；本契约不声称已有线上地址。详见 `ADR-001-monorepo.md`。
