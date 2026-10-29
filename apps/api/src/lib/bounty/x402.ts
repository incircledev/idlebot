/**
 * x402 on Base Sepolia. Option A: the platform wallet receives the bounty on publish
 * and pays it out (or refunds it) later. Keys and facilitator config come from env only.
 *
 * X402_MOCK=1 swaps the facilitator for MockFacilitator: signatures, amounts, payee and
 * validity windows are still checked for real, but nothing is sent on chain, there is no
 * balance check, and tx hashes are random (ledger rows are flagged mock=true).
 */
import { randomBytes } from "node:crypto";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";
import { ExactEvmScheme as ExactEvmServer } from "@x402/evm/exact/server";
import { ExactEvmScheme as ExactEvmClient } from "@x402/evm/exact/client";
import { x402Client } from "@x402/fetch";
import { getAddress, isAddress, verifyTypedData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BOUNTY_NETWORK } from "@idlebot/contract";
import { authorizationUsedOnChain, findAuthorizationTx, sleep, waitForSuccess, waitForUsdc } from "./chain";
import { HttpError } from "@/lib/http";
import { formatUsdc } from "./money";

export const NETWORK = BOUNTY_NETWORK;
export const EXPLORER = "https://sepolia.basescan.org";

export function isMockMode() {
  return process.env.X402_MOCK === "1";
}

export function explorerTx(hash: string | null, mock: boolean) {
  return hash && !mock ? `${EXPLORER}/tx/${hash}` : null;
}

function platformAccount() {
  const raw = process.env.X402_PLATFORM_PRIVATE_KEY?.trim();
  if (!raw) throw new HttpError(503, "Bounty payments are not configured (X402_PLATFORM_PRIVATE_KEY)");
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  return privateKeyToAccount(key);
}

export function platformAddress(): Hex {
  return platformAccount().address;
}

export function normalizeAddress(raw: unknown): string | null | { error: string } {
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(raw.trim()) || !isAddress(raw.trim(), { strict: false })) {
    return { error: "walletAddress must be 0x followed by 40 hex characters" };
  }
  return getAddress(raw.trim());
}

// ---------- mock facilitator ----------

const TRANSFER_WITH_AUTH = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

type Authorization = {
  from: Hex;
  to: Hex;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
};

const mockNonces = (globalThis as unknown as { x402MockNonces?: Set<string> }).x402MockNonces ??
  ((globalThis as unknown as { x402MockNonces: Set<string> }).x402MockNonces = new Set());

class MockFacilitator {
  async getSupported(): Promise<SupportedResponse> {
    return {
      kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }],
      extensions: [],
      signers: { "eip155:*": [] },
    };
  }

  async verify(payload: PaymentPayload, req: PaymentRequirements): Promise<VerifyResponse> {
    const inner = payload.payload as { authorization?: Authorization; signature?: Hex };
    const auth = inner.authorization;
    if (!auth || !inner.signature) return { isValid: false, invalidReason: "invalid_payload" };
    const now = Math.floor(Date.now() / 1000);
    if (getAddress(auth.to) !== getAddress(req.payTo)) return { isValid: false, invalidReason: "invalid_exact_evm_recipient_mismatch", payer: auth.from };
    if (BigInt(auth.value) !== BigInt(req.amount)) return { isValid: false, invalidReason: "invalid_exact_evm_payload_authorization_value", payer: auth.from };
    if (Number(auth.validBefore) < now + 6 || Number(auth.validAfter) > now) return { isValid: false, invalidReason: "invalid_exact_evm_payload_authorization_valid_before", payer: auth.from };
    if (mockNonces.has(auth.nonce)) return { isValid: false, invalidReason: "invalid_exact_evm_nonce_used", payer: auth.from };
    const extra = (req.extra ?? {}) as { name?: string; version?: string };
    const ok = await verifyTypedData({
      address: auth.from,
      domain: { name: extra.name ?? "USDC", version: extra.version ?? "2", chainId: 84532, verifyingContract: req.asset as Hex },
      types: TRANSFER_WITH_AUTH,
      primaryType: "TransferWithAuthorization",
      message: {
        from: auth.from,
        to: auth.to,
        value: BigInt(auth.value),
        validAfter: BigInt(auth.validAfter),
        validBefore: BigInt(auth.validBefore),
        nonce: auth.nonce,
      },
      signature: inner.signature,
    });
    if (!ok) return { isValid: false, invalidReason: "invalid_exact_evm_payload_signature", payer: auth.from };
    return { isValid: true, payer: auth.from };
  }

  async settle(payload: PaymentPayload, req: PaymentRequirements): Promise<SettleResponse> {
    const v = await this.verify(payload, req);
    if (!v.isValid) return { success: false, errorReason: v.invalidReason, transaction: "", network: NETWORK, payer: v.payer };
    const auth = (payload.payload as { authorization: Authorization }).authorization;
    mockNonces.add(auth.nonce);
    return { success: true, transaction: `0x${randomBytes(32).toString("hex")}`, network: NETWORK, payer: auth.from };
  }
}

// ---------- resource server ----------

type Holder = { server?: x402ResourceServer; ready?: Promise<void>; mock?: boolean };
const holder = (globalThis as unknown as { x402Holder?: Holder }).x402Holder ??
  ((globalThis as unknown as { x402Holder: Holder }).x402Holder = {});

async function resourceServer() {
  const mock = isMockMode();
  if (!holder.server || holder.mock !== mock) {
    const facilitator = mock
      ? new MockFacilitator()
      : new HTTPFacilitatorClient({ url: process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator" });
    holder.server = new x402ResourceServer(facilitator).register(NETWORK, new ExactEvmServer());
    holder.mock = mock;
    holder.ready = holder.server.initialize();
  }
  try {
    await holder.ready;
  } catch (error) {
    holder.server = undefined;
    throw new HttpError(503, `x402 facilitator unavailable: ${(error as Error).message}`);
  }
  return holder.server;
}

async function requirementsFor(payTo: string, units: number) {
  const server = await resourceServer();
  return server.buildPaymentRequirements({
    scheme: "exact",
    network: NETWORK,
    payTo,
    price: `$${formatUsdc(units)}`,
    maxTimeoutSeconds: 300,
  });
}

export type PaymentOutcome =
  | { kind: "required"; status: 402; body: PaymentRequired & { message?: string }; headers: Record<string, string> }
  | { kind: "paid"; payer: string; txHash: string; mock: boolean; headers: Record<string, string> };

/**
 * Charge `units` USDC to the platform wallet for the request.
 * No PAYMENT-SIGNATURE header -> 402 with PAYMENT-REQUIRED. Otherwise verify then settle.
 */
export async function chargeBounty(request: Request, units: number, description: string): Promise<PaymentOutcome> {
  const server = await resourceServer();
  const reqs = await requirementsFor(platformAddress(), units);
  const resource = { url: new URL(request.url).pathname, description, mimeType: "application/json" };
  const required = async (error?: string, message?: string): Promise<PaymentOutcome> => {
    const pr = await server.createPaymentRequiredResponse(reqs, resource, error);
    // Facilitator messages can embed a full viem call dump; the first line is enough.
    const short = message?.split("\n")[0]?.slice(0, 200);
    return {
      kind: "required",
      status: 402,
      body: short ? { ...pr, message: short } : pr,
      headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(pr) },
    };
  };

  const header = request.headers.get("payment-signature") ?? request.headers.get("x-payment");
  if (!header) return required("Payment required");

  let payload: PaymentPayload;
  try {
    payload = decodePaymentSignatureHeader(header);
  } catch {
    return required("invalid_payment_signature_header");
  }
  const match = server.findMatchingRequirements(reqs, payload);
  if (!match) return required("payment_does_not_match_requirements");
  const settled = await settleWithRetry(payload, match, (msg) => console.warn(`[bounty] publish payment ${msg}`));
  if (!settled.ok) return required(settled.reason, settled.message);
  if (!settled.txHash) {
    // Landed on chain but the facilitator lost the answer and the lookback found no tx: refuse
    // rather than create a task without a payment record. Rare; reconcile by hand from the nonce.
    const nonce = (payload.payload as { authorization: Authorization }).authorization.nonce;
    console.error(`[bounty] publish payment nonce ${nonce} landed but no tx hash found`);
    throw new HttpError(502, "Payment landed on chain but its transaction could not be found; contact support");
  }
  return {
    kind: "paid",
    payer: getAddress(settled.payer ?? (payload.payload as { authorization: Authorization }).authorization.from),
    txHash: settled.txHash,
    mock: isMockMode(),
    headers: settled.response
      ? { "PAYMENT-RESPONSE": encodePaymentResponseHeader(settled.response) }
      : {},
  };
}

export type SignedTransfer = {
  payload: PaymentPayload;
  requirements: PaymentRequirements;
  nonce: Hex;
  validBefore: Date;
  from: Hex;
};

/**
 * Platform wallet -> `to`, step 1: sign an EIP-3009 authorization (relay mode: the facilitator
 * submits it, so the platform wallet needs USDC but no ETH). Persist `nonce` before relaying: it is
 * what lets a retry tell "never sent" from "sent but we lost the answer".
 */
export async function signPlatformTransfer(to: string, units: number, purpose: string): Promise<SignedTransfer> {
  const server = await resourceServer();
  const reqs = await requirementsFor(getAddress(to), units);
  const pr = await server.createPaymentRequiredResponse(reqs, {
    url: `idlebot://${purpose}`,
    description: `IdleBot ${purpose}`,
    mimeType: "application/json",
  });
  const client = x402Client.fromConfig({
    schemes: [{ network: "eip155:84532", client: new ExactEvmClient(platformAccount()) }],
    // Default client cap is $1; bounties go up to 100 USDC (BOUNTY_MAX).
    spendControls: { maxAmountPerPayment: "$100" },
  });
  const payload = await client.createPaymentPayload(pr);
  const auth = (payload.payload as { authorization: Authorization }).authorization;
  return {
    payload,
    requirements: reqs[0],
    nonce: auth.nonce,
    validBefore: new Date(Number(auth.validBefore) * 1000),
    from: platformAddress(),
  };
}

/** Did a previously signed platform authorization land on chain? Returns its tx hash ("" if unknown). */
export async function findLandedTransfer(
  nonce: string,
  from: Hex = platformAddress(),
): Promise<{ landed: boolean; txHash: string | null }> {
  if (isMockMode()) return { landed: mockNonces.has(nonce), txHash: null };
  if (!(await authorizationUsedOnChain(from, nonce as Hex))) return { landed: false, txHash: null };
  // Landed is the fact that matters; the hash is for the receipt. A log-scan failure must not
  // turn a landed transfer into a retry.
  const txHash = await findAuthorizationTx(from, nonce as Hex).catch((error: Error) => {
    console.warn(`[bounty] tx lookup for nonce ${nonce} failed: ${error.message.split("\n")[0]}`);
    return null;
  });
  return { landed: true, txHash };
}

/**
 * Before moving money out, make sure the money that came in is really there: the incoming tx is
 * mined with status success and the platform's USDC balance covers `units`. Without this the
 * facilitator can simulate the payout against a stale balance and fail
 * (invalid_exact_evm_transaction_failed right after the incoming settle).
 */
export async function waitForIncomingFunds(incomingTx: string | null, units: number) {
  if (isMockMode()) return;
  if (incomingTx) await waitForSuccess(incomingTx as Hex);
  await waitForUsdc(platformAddress(), BigInt(units));
}

const SETTLE_BACKOFF_MS = [0, 3_000, 8_000];

type SettleTry =
  | { ok: true; txHash: string | null; payer?: string; response?: SettleResponse; attempts: number }
  | { ok: false; reason: string; message?: string };

/**
 * Verify + settle one signed EIP-3009 payload, up to 3 tries with backoff. Every try reuses the
 * same payload, so the same nonce: USDC accepts it at most once and a retry can never move money
 * twice. After a failed try we ask the chain whether the nonce was used anyway.
 * Seen live on x402.org: back-to-back settles fail with invalid_exact_evm_transaction_failed
 * ("Nonce provided for the transaction is lower than the current nonce" / "Missing or invalid
 * parameters") and succeed a few seconds later.
 */
async function settleWithRetry(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  log: (msg: string) => void = () => {},
): Promise<SettleTry> {
  const server = await resourceServer();
  const mock = isMockMode();
  const auth = (payload.payload as { authorization: Authorization }).authorization;
  const validBefore = Number(auth.validBefore) * 1000;
  let reason = "unknown";
  let message: string | undefined;
  // A nonce that is already used before our first try is a replay, not a payment we just made.
  // Only after this check may "the nonce landed" count as success.
  if (!mock && (await authorizationUsedOnChain(getAddress(auth.from), auth.nonce as Hex))) {
    return { ok: false, reason: "invalid_exact_evm_nonce_used", message: "authorization was already used" };
  }
  for (let attempt = 0; attempt < SETTLE_BACKOFF_MS.length; attempt += 1) {
    if (SETTLE_BACKOFF_MS[attempt]) await sleep(SETTLE_BACKOFF_MS[attempt]);
    if (validBefore - Date.now() < 15_000) {
      message = `authorization expired before try ${attempt + 1}${message ? `; last: ${message}` : ""}`;
      break;
    }
    try {
      const verified = await server.verifyPayment(payload, requirements);
      if (!verified.isValid) {
        reason = verified.invalidReason ?? "invalid_payment";
        message = verified.invalidMessage?.split("\n")[0];
        // Bad signature, wrong payee, wrong amount: retrying cannot help. Balance/nonce races can.
        if (/signature|recipient|value|network|scheme|payload|nonce_used/.test(reason) && !/transaction_failed/.test(reason)) break;
      } else {
        const settled = await server.settlePayment(payload, requirements);
        if (settled.success) {
          if (!mock) await waitForSuccess(settled.transaction as Hex);
          return { ok: true, txHash: settled.transaction, payer: settled.payer ?? verified.payer, response: settled, attempts: attempt + 1 };
        }
        reason = settled.errorReason ?? "settle_failed";
        message = settled.errorMessage?.split("\n")[0];
      }
    } catch (error) {
      reason = "facilitator_error";
      message = (error as Error).message.split("\n")[0];
    }
    log(`try ${attempt + 1}/${SETTLE_BACKOFF_MS.length} ${reason}${message ? ` ${message.slice(0, 160)}` : ""}`);
    if (!mock) {
      // The facilitator may have submitted it even though it reported a failure.
      const landed = await findLandedTransfer(auth.nonce, getAddress(auth.from)).catch(() => null);
      if (landed?.landed) return { ok: true, txHash: landed.txHash, payer: auth.from, attempts: attempt + 1 };
    }
  }
  return { ok: false, reason, message };
}

/** Step 2 for platform transfers: relay the signed authorization (see settleWithRetry). */
export async function relayPlatformTransfer(signed: SignedTransfer, log: (msg: string) => void = () => {}) {
  const result = await settleWithRetry(signed.payload, signed.requirements, log);
  if (!result.ok) throw new Error(`settle failed: ${result.reason}${result.message ? ` ${result.message}` : ""}`);
  return { txHash: result.txHash, from: signed.from as string, mock: isMockMode(), attempts: result.attempts };
}
