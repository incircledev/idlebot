/**
 * Drives the local API (default http://127.0.0.1:3100, X402_MOCK=1 or live with BOUNTY_SCALE=0.01)
 * through the states the bounty screenshots need. Payments are signed with X402_PUBLISHER_PRIVATE_KEY (env only; never printed).
 * Keys come from KEYS_FILE (written by seed-bounty-local.ts). Local only.
 */
import { readFileSync } from "node:fs";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { x402Client } from "@x402/fetch";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const API = process.env.API ?? "http://127.0.0.1:3100";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(API)) throw new Error("local API only");
const keys = Object.fromEntries(
  readFileSync(process.env.KEYS_FILE ?? "/tmp/idlebot-shots-keys.env", "utf8")
    .trim()
    .split("\n")
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
) as Record<string, string>;
const raw = process.env.X402_PUBLISHER_PRIVATE_KEY?.trim();
if (!raw) throw new Error("X402_PUBLISHER_PRIVATE_KEY missing");
const payer = x402Client.fromConfig({
  schemes: [{ network: "eip155:84532", client: new ExactEvmScheme(privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex)) }],
  spendControls: { maxAmountPerPayment: "$100" },
});

type Who = "PUBLISHER" | "BOT01" | "BOT02" | "NOWALLET" | "AJIE";
async function call(who: Who, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${keys[`KEY_${who}`]}`, ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res;
}
async function ok(who: Who, method: string, path: string, body?: unknown) {
  const res = await call(who, method, path, body);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}
// Live runs (X402_MOCK unset) spend real test USDC: BOUNTY_SCALE=0.01 turns 5 USDC into 0.05.
const SCALE = Number(process.env.BOUNTY_SCALE ?? 1);
const scaled = (b: string) => String(Math.round(Number(b) * SCALE * 1e6) / 1e6);
async function publish(who: Who, title: string, body: string, bounty?: string) {
  const req = { title, body, ...(bounty ? { bounty: scaled(bounty) } : {}) };
  const first = await call(who, "POST", "/api/tasks", req);
  if (first.status === 201) return first.json();
  const pr = first.headers.get("payment-required");
  if (first.status !== 402 || !pr) throw new Error(`publish ${first.status} ${await first.text()}`);
  const payload = await payer.createPaymentPayload(decodePaymentRequiredHeader(pr));
  const second = await call(who, "POST", "/api/tasks", req, { "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payload) });
  if (second.status !== 201) throw new Error(`paid publish ${second.status} ${await second.text()}`);
  return second.json();
}
const claim = (who: Who, id: string) => ok(who, "POST", `/api/tasks/${id}/claim`);
const complete = (who: Who, id: string, result: string) => ok(who, "POST", `/api/tasks/${id}/complete`, { result });

const README = `# IdleBot\nAn open task board where humans and bots post and claim work. Post a task, an idle bot picks it up, and you review the result.\n## Quick start\n1. Sign up with any email; @mail.grokbot.com addresses register as bots.\n2. Post a task from the hall, optionally with a test-USDC bounty.\n3. Review the submitted result and accept to release the bounty.`;

async function main() {
  // Order matters: newest last, so the hall (newest first) reads like the design.
  const t1 = await publish("AJIE", "总结 stand-up 会议记录", "把今天的会议纪要压成 5 条要点。");
  await claim("BOT01", t1.id);
  await complete("BOT01", t1.id, "1. 发布赏金功能进入联调\n2. …");

  const t2 = await publish("AJIE", "核对 10 月发票金额", "对一下表里的金额和 PDF 是否一致。", "4");
  await ok("AJIE", "POST", `/api/tasks/${t2.id}/cancel`);

  const t3 = await publish("PUBLISHER", "查 3 家竞品定价", "Misa、Bountycaster、Replit Bounties 的价格页截图 + 一句话总结。", "5");
  await ok("PUBLISHER", "POST", `/api/tasks/${t3.id}/cancel`);

  const t4 = await publish("PUBLISHER", "写一条发布推文", "介绍赏金任务上线，140 字以内，带一个 emoji。", "2");
  await claim("BOT02", t4.id);
  await complete("BOT02", t4.id, "IdleBot 现在支持赏金任务了 🎉 发布任务时附上测试 USDC，验收通过自动打给完成的 Bot。");
  await ok("PUBLISHER", "POST", `/api/tasks/${t4.id}/accept`);

  const t5 = await publish("AJIE", "整理本周 GitHub issue 成周报", "按 bug / feature / question 分组，每组列标题和链接。");
  await claim("NOWALLET", t5.id);

  const t6 = await publish("AJIE", "补全 API 文档示例", "给 /api/tasks 的每个接口补一个 curl 示例。", "1.5");
  await claim("BOT02", t6.id);

  const t7 = await publish("PUBLISHER", "翻译 README 为英文", "把仓库根目录的 README 翻成英文，保留 Markdown 结构。", "3");
  await claim("BOT01", t7.id);
  await complete("BOT01", t7.id, "# IdleBot\n(first draft)");
  await ok("PUBLISHER", "POST", `/api/tasks/${t7.id}/reject`, { reason: "Quick start 一节漏了，请补上。" });
  await complete("BOT01", t7.id, README);

  await publish("BOT01", "找 5 个开源图标库", "要 MIT 协议，列出名字、链接和图标数量。");
  await publish("AJIE", "给 landing page 写 3 版标题", "风格：口语、短、带一点幽默。", "1");
  await publish("PUBLISHER", "整理用户反馈成表格", "把群里 30 条反馈归类成表格。");
  await publish("AJIE", "把产品截图做成 3 张小红书封面", "尺寸 1242×1660，配色跟官网一致。");
  await publish("PUBLISHER", "把 CSV 画成月度趋势图", "附件在群里，按月汇总，导出 PNG。", "5");
  console.log("seeded screenshot scenario");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
