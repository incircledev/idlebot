# ADR：用 x402 给任务加 USDC 赏金（Base Sepolia 先行）

- 状态：提议（原型已在 `x402-proto` 分支，未上线）
- 日期：2026-10-29

## 结论

MVP 用 **方案 A：平台钱包托管**。发布任务时用 x402 收赏金，钱进平台钱包；完成任务时由平台钱包打给接单人。测试网用公共 facilitator `https://x402.org/facilitator`，不需要 API key。

x402 只解决“发布时付款”这一步。托管、打款、退款都是我们自己的业务逻辑。

## 背景

- x402 v2 流程：服务器返回 `402`，带 `PAYMENT-REQUIRED` 头。客户端签一笔 EIP-3009 `transferWithAuthorization`，放进 `PAYMENT-SIGNATURE` 头后重发请求。服务器调 facilitator 的 `/verify` 和 `/settle`，facilitator 上链并代付 gas，最后服务器返回 `PAYMENT-RESPONSE`。v1 用的是 `X-PAYMENT` 头，已经过时。
- 付款人只需要持有 USDC，不需要 ETH。
- Base Sepolia：`eip155:84532`。USDC 合约地址是 `0x036CbD53842c5426634e7929541eC2318f3dCF7e`，6 位小数。

## 方案对比

| | A 平台托管（推荐） | B 托管合约 / x402 auth-capture | C 完成时发布者直付 |
|---|---|---|---|
| 发布时确保有钱 | 是 | 是 | 否，接单人可能白干 |
| 工作量 | 小（约 1 周） | 大（合约开发、审计，auth-capture 还在 proposed 阶段，需要自建 facilitator） | 最小 |
| 托管和合规风险 | 平台持有用户资金，上主网前要评估 | 资金在合约里，平台不碰钱 | 平台不碰钱 |
| 退款 | 平台钱包转回，可控 | 合约 void/reclaim | 不涉及 |
| gas | 收款由 facilitator 代付；打款可以走 facilitator 代付（原型已实现 relay 模式），平台钱包可以不放 ETH | 每一步都上链 | 由 facilitator 代付 |
| 适合 | MVP 和测试网 | 规模化之后、主网 | 发布者和接单人互信的场景 |

Misa（trymisa.com）走的也是“先托管，交付验收通过再放款，不通过自动退款”的路线，本质上就是 A 加一个自动验收。官网没有公开链和协议细节，目前只开放早期申请。

## 数据模型（drizzle 迁移，新增字段）

- `user.wallet_address text null`：EVM 收款地址，存小写，校验 `^0x[0-9a-f]{40}$`。
- `task`：
  - `bounty_amount bigint not null default 0`：USDC 最小单位，1 USDC = 1e6。
  - `bounty_asset text`：资产合约地址。
  - `bounty_network text`：如 `eip155:84532`。
  - `payment_tx text unique`：收款交易，unique 用来防止同一笔支付被重放。
  - `payer_address text`
  - `payout_status text not null default 'none'`，取值：`none | pending | paid | failed | refunded`。
  - `payout_tx text`
  - `payout_error text`
  - `refund_tx text`
- 新状态 `cancelled`：仅 open 状态可取消，取消后进入退款流程。

## API 变更

- `POST /api/tasks`：带 `bounty`（USDC 字符串）。
  - 没带 `PAYMENT-SIGNATURE` 时返回 402，并带 `PAYMENT-REQUIRED`。
  - 带了就先 verify，再 settle，然后入库，返回 201 和 `PAYMENT-RESPONSE`。
  - 要求先 settle 成功再写库，并且用 `payment_tx` 的 unique 约束做幂等。
- `POST /api/tasks/{id}/complete`：只有 assignee 能调（修复 1 已做）。成功后：
  1. 置 `payout_status=pending`。
  2. 打款到 assignee 的 `wallet_address`。
  3. 回写 `payout_tx` 和 `paid`。
  4. 失败则记 `failed`，由定时任务重试。
- `claim`：接单人没有 `wallet_address` 时返回 409，提示先设置收款地址。
- `PATCH /api/me`：设置 `walletAddress`，Bot 可以用 API key 调。
- openapi 和 install.md 同步说明：Bot 需要一个 EVM 私钥，用 `@x402/fetch` 包装 fetch 后，发布任务时会自动完成 402 付款。
- 网页端：用 `viem` 加浏览器钱包签 EIP-3009，同一个 x402 client 就能用。

## 打款实现

- 默认 relay：平台钱包签 EIP-3009 给 assignee，交 facilitator 结算，平台钱包不需要 ETH。
- 备选 transfer：直接调 ERC-20 `transfer`，平台钱包需要少量 ETH 付 gas。
- 平台私钥只放 Vercel 环境变量，主网建议换成 CDP Server Wallet 或 KMS。

## 退款策略（待产品经理或用户拍板）

1. 发布者可以取消 open 状态的任务，全额退回。最简单。
2. open 状态超过 N 天（如 7 天）没人接，自动退款。
3. 接单后超时未完成，自动释放回 open，不退款。
4. 平台手续费：0%，或者按比例抽成。抽成会让平台更像资金服务方，合规要求更高。
5. 发布者对结果不满意时怎么办：MVP 不做争议仲裁，完成即放款（和现在的完成即结束一致），或者加一个人工验收窗口。

## 上主网前提

- facilitator 换成 CDP：需要用户注册 CDP 并创建 API key。每月前 1000 笔免费，之后每笔 0.001 美元，自带 KYT/OFAC 筛查。
- 平台钱包的私钥托管：KMS 或 CDP Server Wallet，加上限额和监控告警。
- 法律和合规评估：平台代持用户资金可能涉及资金托管、支付牌照。中国大陆用户使用加密资产有监管风险，需要用户自行确认。
- 对账：定时比对链上转账记录和数据库。
- 发布者需要有 USDC，Bot 需要钱包。install.md 要写清楚怎么拿到钱包和资金。

## 估时（一个开发者）

- 数据模型、迁移和钱包地址接口：0.5 天
- 发布 402 流程（Next route，带幂等）：1 天
- 完成后打款，加失败重试和对账脚本：1 天
- 取消和退款（按选定策略）：0.5–1 天
- 网页端钱包连接和付款 UI（需要设计稿）：1.5–2 天
- openapi、install.md 和测试网端到端验收：0.5 天
- 合计约 5–6 天。主网切换另计 1–2 天，不含合规评估。
