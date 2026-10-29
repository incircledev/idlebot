/**
 * x402 bounty prototype on Base Sepolia (eip155:84532). Standalone; touches no DB.
 *
 *   publisher --POST /tasks {bounty}--> 402 PAYMENT-REQUIRED
 *   publisher --POST /tasks + PAYMENT-SIGNATURE--> verify + settle via facilitator --> 201 (USDC now in platform wallet)
 *   assignee claims, completes --> platform pays the assignee (payout)
 *
 * Keys come only from env (default: /workspace/idlebot/apps/api/.env.local). Nothing secret is printed.
 * Run: pnpm exec tsx scripts/x402-proto/demo.ts
 * Env: X402_PLATFORM_PRIVATE_KEY, X402_PUBLISHER_PRIVATE_KEY, X402_ASSIGNEE_PRIVATE_KEY,
 *      BOUNTY_USDC (default 0.01), FACILITATOR_URL (default https://x402.org/facilitator),
 *      PAYOUT_MODE=relay|transfer (relay: platform signs an EIP-3009 transfer and the facilitator
 *      submits it, so the platform wallet needs no ETH; transfer: plain ERC-20 transfer, needs ETH gas).
 */
import http from "node:http";
import { config } from "dotenv";
import { createPublicClient, createWalletClient, http as viemHttp, erc20Abi, formatUnits, parseUnits, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme as ExactEvmServer } from "@x402/evm/exact/server";
import { ExactEvmScheme as ExactEvmClient } from "@x402/evm/exact/client";
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";

config({ path: process.env.X402_ENV_FILE ?? "/workspace/idlebot/apps/api/.env.local", quiet: true });

const NETWORK = "eip155:84532" as const;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const; // Base Sepolia USDC (x402 docs + Circle docs)
const SCAN = "https://sepolia.basescan.org";
const PORT = 4402;
const BOUNTY = process.env.BOUNTY_USDC ?? "0.01";
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "https://x402.org/facilitator";
const PAYOUT_MODE = (process.env.PAYOUT_MODE ?? "relay") as "relay" | "transfer";

function key(name: string): Hex {
  const v = process.env[name];
  if (!v || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`missing ${name}`);
  return v as Hex;
}
const platform = privateKeyToAccount(key("X402_PLATFORM_PRIVATE_KEY"));
const publisher = privateKeyToAccount(key("X402_PUBLISHER_PRIVATE_KEY"));
const assignee = privateKeyToAccount(key("X402_ASSIGNEE_PRIVATE_KEY"));

const chain = createPublicClient({ chain: baseSepolia, transport: viemHttp() });
const usdc = async (a: Hex) => formatUnits(await chain.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a] }), 6);
const eth = async (a: Hex) => formatUnits(await chain.getBalance({ address: a }), 18);
async function balances(label: string) {
  const rows = await Promise.all(
    ([["platform", platform.address], ["publisher", publisher.address], ["assignee", assignee.address]] as const).map(
      async ([n, a]) => `${n.padEnd(9)} ${a}  USDC=${await usdc(a)}  ETH=${await eth(a)}`,
    ),
  );
  console.log(`\n[balances ${label}]\n  ${rows.join("\n  ")}`);
}

// ---------- "IdleBot API" side ----------
const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitator).register(NETWORK, new ExactEvmServer());

type Task = { id: string; title: string; bounty: string; status: "open" | "claimed" | "done"; paymentTx?: string; payer?: string; assignee?: Hex; payoutTx?: string; payoutStatus?: string };
const tasks = new Map<string, Task>();

const requirementsFor = (payTo: Hex, amount: string) =>
  resourceServer.buildPaymentRequirements({ scheme: "exact", network: NETWORK, payTo, price: `$${amount}`, maxTimeoutSeconds: 300 });

async function readJson(req: http.IncomingMessage) {
  let s = "";
  for await (const c of req) s += c;
  return s ? JSON.parse(s) : {};
}
function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

async function payout(task: Task): Promise<{ tx: string; mode: string }> {
  if (PAYOUT_MODE === "transfer") {
    const wallet = createWalletClient({ account: platform, chain: baseSepolia, transport: viemHttp() });
    const hash = await wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [task.assignee!, parseUnits(task.bounty, 6)] });
    await chain.waitForTransactionReceipt({ hash });
    return { tx: hash, mode: "transfer" };
  }
  // relay: platform wallet acts as an x402 client paying the assignee; the facilitator submits the EIP-3009 transfer (gasless for us).
  const reqs = await requirementsFor(task.assignee!, task.bounty);
  const pr = await resourceServer.createPaymentRequiredResponse(reqs, { url: `idlebot://payout/${task.id}`, description: "IdleBot bounty payout", mimeType: "application/json" });
  const platformClient = new x402Client().register("eip155:*", new ExactEvmClient(platform));
  const payload = await platformClient.createPaymentPayload(pr);
  const v = await resourceServer.verifyPayment(payload, reqs[0]);
  if (!v.isValid) throw new Error(`payout verify failed: ${v.invalidReason} ${v.invalidMessage ?? ""}`);
  const s = await resourceServer.settlePayment(payload, reqs[0]);
  if (!s.success) throw new Error(`payout settle failed: ${s.errorReason}`);
  return { tx: s.transaction, mode: "relay(EIP-3009 via facilitator)" };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url!, `http://localhost:${PORT}`);
    if (req.method === "POST" && url.pathname === "/tasks") {
      const body = await readJson(req);
      const bounty = String(body.bounty ?? "");
      if (!/^\d+(\.\d{1,6})?$/.test(bounty) || Number(bounty) <= 0) return send(res, 400, { error: "bounty required" });
      const reqs = await requirementsFor(platform.address, bounty);
      const resource = { url: url.href, description: `Publish task with ${bounty} USDC bounty`, mimeType: "application/json" };
      const sig = req.headers["payment-signature"] as string | undefined;
      if (!sig) {
        const pr = await resourceServer.createPaymentRequiredResponse(reqs, resource);
        return send(res, 402, pr, { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(pr) });
      }
      const payload = decodePaymentSignatureHeader(sig);
      const match = resourceServer.findMatchingRequirements(reqs, payload);
      if (!match) return send(res, 402, { error: "payment does not match requirements" });
      const v = await resourceServer.verifyPayment(payload, match);
      console.log(`  [server] facilitator /verify -> isValid=${v.isValid}${v.isValid ? "" : ` reason=${v.invalidReason} ${v.invalidMessage ?? ""}`}`);
      if (!v.isValid) {
        const pr = await resourceServer.createPaymentRequiredResponse(reqs, resource, v.invalidReason);
        return send(res, 402, { ...pr, error: v.invalidReason, message: v.invalidMessage }, { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(pr) });
      }
      const s = await resourceServer.settlePayment(payload, match);
      console.log(`  [server] facilitator /settle -> success=${s.success} tx=${s.transaction}`);
      if (!s.success) return send(res, 402, { error: s.errorReason });
      const id = `t${tasks.size + 1}`;
      const task: Task = { id, title: String(body.title ?? "untitled"), bounty, status: "open", paymentTx: s.transaction, payer: s.payer };
      tasks.set(id, task);
      return send(res, 201, task, { "PAYMENT-RESPONSE": encodePaymentResponseHeader(s) });
    }
    const m = url.pathname.match(/^\/tasks\/(\w+)\/(claim|complete)$/);
    if (req.method === "POST" && m) {
      const task = tasks.get(m[1]);
      if (!task) return send(res, 404, { error: "not found" });
      const body = await readJson(req);
      if (m[2] === "claim") {
        if (task.status !== "open") return send(res, 409, { error: "not open" });
        Object.assign(task, { status: "claimed", assignee: body.payoutAddress });
        return send(res, 200, task);
      }
      if (task.status !== "claimed" || body.payoutAddress !== task.assignee) return send(res, 403, { error: "only the assignee can complete" });
      task.status = "done";
      task.payoutStatus = "pending";
      try {
        const p = await payout(task);
        Object.assign(task, { payoutTx: p.tx, payoutStatus: `paid via ${p.mode}` });
      } catch (e) {
        task.payoutStatus = `failed: ${(e as Error).message}`;
      }
      return send(res, 200, task);
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: (e as Error).message });
  }
});

// ---------- demo driver ----------
async function main() {
  await resourceServer.initialize(); // fetches facilitator /supported
  await new Promise<void>((r) => server.listen(PORT, r));
  console.log(`facilitator=${FACILITATOR_URL} network=${NETWORK} bounty=${BOUNTY} USDC payout=${PAYOUT_MODE}`);
  await balances("before");

  const base = `http://localhost:${PORT}`;
  const body = JSON.stringify({ title: "Summarize 3 x402 docs", bounty: BOUNTY });

  // 1) Unpaid publish -> 402 challenge
  const r1 = await fetch(`${base}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body });
  const challenge = await r1.json();
  console.log(`\n[1] POST /tasks without payment -> HTTP ${r1.status}, PAYMENT-REQUIRED header ${r1.headers.get("payment-required") ? "present" : "missing"}`);
  console.log(JSON.stringify(challenge.accepts, null, 2));

  // 2) Publisher pays with the x402 fetch wrapper (signs EIP-3009 transferWithAuthorization; no ETH needed)
  const client = new x402Client().register("eip155:*", new ExactEvmClient(publisher));
  client.setSpendControls({ maxAmountPerPayment: "$1" });
  const payFetch = wrapFetchWithPayment(fetch, client);
  const r2 = await payFetch(`${base}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body });
  const task = await r2.json();
  console.log(`\n[2] POST /tasks with PAYMENT-SIGNATURE -> HTTP ${r2.status}`);
  if (r2.status !== 201) {
    console.log(JSON.stringify(task, null, 2));
    console.log(`\nBLOCKED: payment not settled. Publisher ${publisher.address} needs >= ${BOUNTY} Base Sepolia USDC (no ETH needed).`);
    server.close();
    process.exitCode = 2;
    return;
  }
  const settle = new x402HTTPClient(client).getPaymentSettleResponse((n) => r2.headers.get(n));
  console.log(`    task=${task.id} paymentTx=${SCAN}/tx/${task.paymentTx} payer=${settle.payer}`);

  // 3) Assignee claims and completes -> payout
  await fetch(`${base}/tasks/${task.id}/claim`, { method: "POST", body: JSON.stringify({ payoutAddress: assignee.address }) });
  const rX = await fetch(`${base}/tasks/${task.id}/complete`, { method: "POST", body: JSON.stringify({ payoutAddress: publisher.address }) });
  console.log(`\n[3a] complete by a non-assignee -> HTTP ${rX.status}`);
  const r3 = await fetch(`${base}/tasks/${task.id}/complete`, { method: "POST", body: JSON.stringify({ payoutAddress: assignee.address }) });
  const done = await r3.json();
  console.log(`[3b] complete by assignee -> HTTP ${r3.status} status=${done.status} payout=${done.payoutStatus}`);
  if (done.payoutTx) console.log(`     payoutTx=${SCAN}/tx/${done.payoutTx}`);

  await new Promise((r) => setTimeout(r, 4000));
  await balances("after");
  server.close();
  if (!done.payoutTx) process.exitCode = 3;
}
main().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
