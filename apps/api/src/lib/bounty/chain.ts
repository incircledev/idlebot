/**
 * Read-only Base Sepolia helpers for the bounty money path. No keys here.
 * BASE_SEPOLIA_RPC_URL overrides the public RPC.
 */
import { createPublicClient, erc20Abi, http, parseAbi, parseAbiItem, type Hex } from "viem";
import { baseSepolia } from "viem/chains";

/** Base Sepolia USDC (Circle). Same address the x402 exact scheme advertises for eip155:84532. */
export const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;

const eip3009Abi = parseAbi(["function authorizationState(address authorizer, bytes32 nonce) view returns (bool)"]);
const zero = BigInt(0);
const one = BigInt(1);
const authorizationUsed = parseAbiItem("event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)");

type Holder = { client?: ReturnType<typeof makeClient> };
const holder = (globalThis as unknown as { bountyChain?: Holder }).bountyChain ??
  ((globalThis as unknown as { bountyChain: Holder }).bountyChain = {});

function makeClient() {
  return createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL || undefined) });
}

export function chainClient() {
  return (holder.client ??= makeClient());
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function usdcBalance(address: Hex): Promise<bigint> {
  return chainClient().readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [address] });
}

/** Wait until `hash` is mined. Throws if it reverted or does not show up within `timeoutMs`. */
export async function waitForSuccess(hash: Hex, timeoutMs = 90_000) {
  const receipt = await chainClient().waitForTransactionReceipt({ hash, timeout: timeoutMs, pollingInterval: 1_500 });
  if (receipt.status !== "success") throw new Error(`tx ${hash} reverted`);
  return receipt;
}

/** Poll until `address` holds at least `units` USDC base units. */
export async function waitForUsdc(address: Hex, units: bigint, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let balance = BigInt(0);
  for (;;) {
    balance = await usdcBalance(address);
    if (balance >= units) return balance;
    if (Date.now() > deadline) {
      throw new Error(`platform USDC balance ${balance} < ${units} after ${Math.round(timeoutMs / 1000)}s`);
    }
    await sleep(2_000);
  }
}

/** True once an EIP-3009 authorization nonce has been used on chain (the transfer happened). */
export async function authorizationUsedOnChain(authorizer: Hex, nonce: Hex): Promise<boolean> {
  return chainClient().readContract({ address: USDC_ADDRESS, abi: eip3009Abi, functionName: "authorizationState", args: [authorizer, nonce] });
}

/** Find the tx that used `nonce`, scanning back `lookbackBlocks` (Base: ~2s per block). */
export async function findAuthorizationTx(authorizer: Hex, nonce: Hex, lookbackBlocks = BigInt(6_000)): Promise<Hex | null> {
  const client = chainClient();
  const latest = await client.getBlockNumber();
  const floor = latest > lookbackBlocks ? latest - lookbackBlocks : zero;
  // sepolia.base.org rejects eth_getLogs over more than 200 blocks (HTTP 413). Newest first, so a
  // recent settle (the usual case) is found in one or two calls; 6000 blocks is about 3.3 hours.
  const step = BigInt(Number(process.env.BASE_SEPOLIA_LOG_RANGE ?? 200));
  for (let to = latest; to > floor; to -= step) {
    const from = to - step + one > floor ? to - step + one : floor;
    const logs = await client.getLogs({
      address: USDC_ADDRESS,
      event: authorizationUsed,
      args: { authorizer, nonce },
      fromBlock: from,
      toBlock: to,
    });
    if (logs.length) return logs[0].transactionHash;
  }
  return null;
}
