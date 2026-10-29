/**
 * Live Base Sepolia acceptance for bounty P0 against a LOCAL API running with X402_MOCK unset
 * (scripts/dev-bounty-local.sh with X402_MOCK=0). Real x402.org facilitator, real USDC.
 *   a. publish+pay -> claim -> submit -> accept -> payout
 *   b. publish+pay -> cancel -> refund
 *   c. two concurrent accepts on one pending_review task -> exactly one payout tx + one ledger row
 * Every tx receipt is checked with viem. Keys come from env only and are never printed.
 * Env: X402_PUBLISHER_PRIVATE_KEY, X402_PLATFORM_PRIVATE_KEY, X402_ASSIGNEE_PRIVATE_KEY (addresses only),
 *      KEYS_FILE (local API keys), API (default http://127.0.0.1:3100), BOUNTY (default 0.01), OUT.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { x402Client } from "@x402/fetch";
import { createPublicClient, erc20Abi, formatUnits, http, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { Client } from "pg";

const API = process.env.API ?? "http://127.0.0.1:3100";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(API)) throw new Error("local API only");
const DB = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55433/postgres";
if (!/@(127\.0\.0\.1|localhost):/.test(DB)) throw new Error("local DB only");
const BOUNTY = process.env.BOUNTY ?? "0.01";
const OUT = process.env.OUT ?? "/workspace/shots-bounty/live-chain.txt";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const SCAN = "https://sepolia.basescan.org/tx/";

const keys = Object.fromEntries(
  readFileSync(process.env.KEYS_FILE ?? "/tmp/idlebot-shots-keys.env", "utf8")
    .trim()
    .split("\n")
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
) as Record<string, string>;
const acct = (name: string) => {
  const raw = process.env[name]?.trim();
  if (!raw) throw new Error(`${name} missing`);
  return privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex);
};
const publisherAcct = acct("X402_PUBLISHER_PRIVATE_KEY");
const wallets = {
  publisher: publisherAcct.address,
  platform: acct("X402_PLATFORM_PRIVATE_KEY").address,
  assignee: acct("X402_ASSIGNEE_PRIVATE_KEY").address,
};
const payer = x402Client.fromConfig({
  schemes: [{ network: "eip155:84532", client: new ExactEvmScheme(publisherAcct) }],
  spendControls: { maxAmountPerPayment: "$1" },
});
const chain = createPublicClient({ chain: baseSepolia, transport: http() });

const lines: string[] = [];
const log = (s = "") => {
  console.log(s);
  lines.push(s);
};
let failures = 0;
const expect = (ok: boolean, what: string) => {
  log(`  ${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failures += 1;
};

async function balances(label: string) {
  log(`[balances ${label}] ${new Date().toISOString()}`);
  const out: Record<string, bigint> = {};
  for (const [name, addr] of Object.entries(wallets)) {
    const usdc = await chain.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [addr] });
    const eth = await chain.getBalance({ address: addr });
    out[name] = usdc;
    log(`  ${name.padEnd(9)} ${addr}  USDC=${formatUnits(usdc, 6)}  ETH=${formatUnits(eth, 18)}`);
  }
  return out;
}

type Who = "PUBLISHER" | "BOT01";
async function call(who: Who, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  return fetch(API + path, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${keys[`KEY_${who}`]}`, ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function ok(who: Who, method: string, path: string, body?: unknown) {
  const res = await call(who, method, path, body);
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return JSON.parse(text);
}
async function publish(title: string) {
  const req = { title, body: "链上验收（Base Sepolia，真实 USDC）", bounty: BOUNTY };
  const first = await call("PUBLISHER", "POST", "/api/tasks", req);
  const pr = first.headers.get("payment-required");
  expect(first.status === 402 && !!pr, `unpaid publish -> ${first.status} with PAYMENT-REQUIRED`);
  const payload = await payer.createPaymentPayload(decodePaymentRequiredHeader(pr!));
  const t0 = Date.now();
  const second = await call("PUBLISHER", "POST", "/api/tasks", req, { "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payload) });
  const text = await second.text();
  expect(second.status === 201, `paid publish -> ${second.status} in ${Date.now() - t0}ms`);
  if (second.status !== 201) throw new Error(text);
  return JSON.parse(text);
}

type Item = { kind: string; amount: string; from: string; to: string; txHash: string | null; status: string; mock: boolean };
async function receipt(id: string): Promise<Item[]> {
  return (await ok("PUBLISHER", "GET", `/api/tasks/${id}/receipt`)).items;
}
async function checkTx(item: Item, wantFrom: string, wantTo: string) {
  if (!item.txHash) return expect(false, `${item.kind} has a tx hash`);
  const r = await chain.waitForTransactionReceipt({ hash: item.txHash as Hex, timeout: 90_000 });
  log(`  ${item.kind.padEnd(7)} ${item.amount} USDC ${item.from} -> ${item.to}`);
  log(`          ${SCAN}${item.txHash}  block=${r.blockNumber} receipt.status=${r.status}`);
  expect(r.status === "success", `${item.kind} receipt status success`);
  expect(!item.mock && item.status === "confirmed", `${item.kind} ledger confirmed, mock=false`);
  expect(item.from?.toLowerCase() === wantFrom.toLowerCase() && item.to?.toLowerCase() === wantTo.toLowerCase(), `${item.kind} from/to match`);
}

async function ledgerCount(taskId: string, kind: string) {
  const db = new Client({ connectionString: DB });
  await db.connect();
  const r = await db.query("select count(*)::int as n from bounty_ledger where task_id = $1 and kind = $2", [taskId, kind]);
  await db.end();
  return r.rows[0].n as number;
}

async function main() {
  log(`IdleBot bounty P0 — live Base Sepolia run (X402_MOCK unset, facilitator https://x402.org/facilitator)`);
  log(`API=${API} bounty=${BOUNTY} USDC per task`);
  const before = await balances("before");

  log("\n== a. publish+pay -> claim -> submit -> accept -> payout");
  const a = await publish("链上验收 a：验收打款");
  await ok("BOT01", "POST", `/api/tasks/${a.id}/claim`);
  await ok("BOT01", "POST", `/api/tasks/${a.id}/complete`, { result: "链上验收结果 a" });
  const t0 = Date.now();
  const accA = await ok("PUBLISHER", "POST", `/api/tasks/${a.id}/accept`);
  expect(accA.status === "completed" && accA.payoutStatus === "paid", `accept -> ${accA.status}/${accA.payoutStatus} in ${Date.now() - t0}ms`);
  const ra = await receipt(a.id);
  log(`  task ${a.id}`);
  await checkTx(ra.find((i) => i.kind === "payment")!, wallets.publisher, wallets.platform);
  await checkTx(ra.find((i) => i.kind === "payout")!, wallets.platform, wallets.assignee);

  log("\n== b. publish+pay -> cancel -> refund");
  const b = await publish("链上验收 b：取消退款");
  const t1 = Date.now();
  const canB = await ok("PUBLISHER", "POST", `/api/tasks/${b.id}/cancel`);
  expect(canB.status === "cancelled" && canB.payoutStatus === "refunded", `cancel -> ${canB.status}/${canB.payoutStatus} in ${Date.now() - t1}ms`);
  const again = await ok("PUBLISHER", "POST", `/api/tasks/${b.id}/cancel`);
  expect(again.payoutStatus === "refunded", "second cancel is idempotent");
  const rb = await receipt(b.id);
  log(`  task ${b.id}`);
  await checkTx(rb.find((i) => i.kind === "payment")!, wallets.publisher, wallets.platform);
  await checkTx(rb.find((i) => i.kind === "refund")!, wallets.platform, wallets.publisher);
  expect(rb.filter((i) => i.kind === "refund").length === 1, "exactly one refund row");

  log("\n== c. two concurrent accepts on one pending_review task");
  const c = await publish("链上验收 c：并发验收");
  await ok("BOT01", "POST", `/api/tasks/${c.id}/claim`);
  await ok("BOT01", "POST", `/api/tasks/${c.id}/complete`, { result: "链上验收结果 c" });
  const t2 = Date.now();
  const both = await Promise.all(
    [1, 2].map(async (n) => {
      const res = await call("PUBLISHER", "POST", `/api/tasks/${c.id}/accept`);
      const body = await res.json();
      return { n, http: res.status, status: body.status, payoutStatus: body.payoutStatus, ms: Date.now() - t2 };
    }),
  );
  for (const r of both) log(`  accept#${r.n} -> HTTP ${r.http} status=${r.status} payoutStatus=${r.payoutStatus} (${r.ms}ms)`);
  expect(both.every((r) => r.http === 200), "both accepts answer 200 (no 5xx, no 409)");
  expect(both.filter((r) => r.payoutStatus === "paid").length >= 1, "one accept returns paid");
  // The loser may answer while the winner is still relaying; wait for the final state.
  let rc = await receipt(c.id);
  for (let i = 0; i < 30 && !rc.some((x) => x.kind === "payout" && x.status === "confirmed"); i++) {
    await new Promise((r) => setTimeout(r, 2000));
    rc = await receipt(c.id);
  }
  log(`  task ${c.id}`);
  await checkTx(rc.find((i) => i.kind === "payment")!, wallets.publisher, wallets.platform);
  const payouts = rc.filter((i) => i.kind === "payout");
  expect(payouts.length === 1, `receipt shows ${payouts.length} payout row(s)`);
  expect((await ledgerCount(c.id, "payout")) === 1, "bounty_ledger has exactly 1 payout row (DB)");
  await checkTx(payouts[0], wallets.platform, wallets.assignee);
  const third = await ok("PUBLISHER", "POST", `/api/tasks/${c.id}/accept`);
  expect(third.payoutStatus === "paid" && (await ledgerCount(c.id, "payout")) === 1, "a third accept is a no-op");

  await new Promise((r) => setTimeout(r, 4000));
  const after = await balances("after");
  const u = (n: bigint) => formatUnits(n, 6);
  const units = BigInt(Math.round(Number(BOUNTY) * 1e6));
  log(`\n[delta] publisher ${u(after.publisher - before.publisher)}  platform ${u(after.platform - before.platform)}  assignee ${u(after.assignee - before.assignee)} USDC`);
  expect(after.publisher - before.publisher === -BigInt(2) * units, "publisher: -3 payments +1 refund = -2 bounties");
  expect(after.platform - before.platform === BigInt(0), "platform nets 0 (3 in, 3 out)");
  expect(after.assignee - before.assignee === BigInt(2) * units, "assignee: +2 payouts (a and c)");
  log(`\n${failures ? `FAILURES: ${failures}` : "ALL PASS"}`);
  log(`TASKS a=${a.id} b=${b.id} c=${c.id}`);
  writeFileSync(OUT, lines.join("\n") + "\n");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  log(`ERROR ${e instanceof Error ? e.message : e}`);
  writeFileSync(OUT, lines.join("\n") + "\n");
  process.exit(1);
});
