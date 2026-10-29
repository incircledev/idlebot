/**
 * Test client: POST a JSON body, answer the 402 with an x402 v2 payment signed by
 * X402_PUBLISHER_PRIVATE_KEY (env only; never printed), and print both responses.
 * Usage: tsx scripts/x402-pay.ts <url> <bearer> '<json>'
 */
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { x402Client } from "@x402/fetch";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const [url, bearer, body] = process.argv.slice(2);
const raw = process.env.X402_PUBLISHER_PRIVATE_KEY?.trim();
if (!url || !bearer || !body || !raw) {
  console.error("usage: X402_PUBLISHER_PRIVATE_KEY=… tsx scripts/x402-pay.ts <url> <bearer> '<json>'");
  process.exit(2);
}
const account = privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex);
const headers = { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` };

async function main() {
  const first = await fetch(url, { method: "POST", headers, body });
  console.log(`> POST ${new URL(url).pathname}  (no payment)`);
  console.log(`< ${first.status}`);
  const prHeader = first.headers.get("payment-required");
  if (first.status !== 402 || !prHeader) {
    console.log(await first.text());
    return;
  }
  const pr = decodePaymentRequiredHeader(prHeader);
  const a = pr.accepts[0];
  console.log(`< PAYMENT-REQUIRED: x402Version=${pr.x402Version} scheme=${a.scheme} network=${a.network} amount=${a.amount} asset=${a.asset} payTo=${a.payTo}`);
  const client = x402Client.fromConfig({
    schemes: [{ network: "eip155:84532", client: new ExactEvmScheme(account) }],
    // Default client cap is $1; bounties go up to 100 USDC (BOUNTY_MAX).
    spendControls: { maxAmountPerPayment: "$100" },
  });
  const payload = await client.createPaymentPayload(pr);
  console.log(`> POST ${new URL(url).pathname}  (PAYMENT-SIGNATURE from ${account.address})`);
  const second = await fetch(url, {
    method: "POST",
    headers: { ...headers, "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payload) },
    body,
  });
  console.log(`< ${second.status}`);
  const resp = second.headers.get("payment-response");
  if (resp) console.log(`< PAYMENT-RESPONSE: ${JSON.stringify(decodePaymentResponseHeader(resp))}`);
  const again = second.headers.get("payment-required");
  if (again) {
    const decoded = decodePaymentRequiredHeader(again);
    console.log(`< PAYMENT-REQUIRED error: ${decoded.error}`);
  }
  console.log(await second.text());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
