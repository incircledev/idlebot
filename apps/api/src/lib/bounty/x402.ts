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
  const verified = await server.verifyPayment(payload, match);
  if (!verified.isValid) return required(verified.invalidReason ?? "invalid_payment", verified.invalidMessage);
  const settled = await server.settlePayment(payload, match);
  if (!settled.success) return required(settled.errorReason ?? "settle_failed", settled.errorMessage);
  return {
    kind: "paid",
    payer: getAddress(settled.payer ?? verified.payer ?? (payload.payload as { authorization: Authorization }).authorization.from),
    txHash: settled.transaction,
    mock: isMockMode(),
    headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader(settled) },
  };
}

/**
 * Platform wallet -> `to`. Relay mode: the platform signs an EIP-3009 authorization and the
 * facilitator submits it, so the platform wallet needs USDC but no ETH.
 */
export async function sendFromPlatform(to: string, units: number, purpose: string) {
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
  const verified = await server.verifyPayment(payload, reqs[0]);
  if (!verified.isValid) {
    throw new Error(`verify failed: ${verified.invalidReason ?? "unknown"}${verified.invalidMessage ? ` ${verified.invalidMessage}` : ""}`);
  }
  const settled = await server.settlePayment(payload, reqs[0]);
  if (!settled.success) throw new Error(`settle failed: ${settled.errorReason ?? "unknown"}`);
  return { txHash: settled.transaction, from: platformAddress() as string, mock: isMockMode() };
}
