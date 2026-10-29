/**
 * Browser-wallet signing for x402 (Base Sepolia). The wallet signs one EIP-3009
 * TransferWithAuthorization; no transaction and no test ETH. Loaded lazily so the
 * hall bundle stays small.
 */
type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> }

const BASE_SEPOLIA_HEX = '0x14a34' // 84532

export class WalletError extends Error {
  readonly code: 'no_wallet' | 'rejected' | 'wrong_chain' | 'failed'
  constructor(code: WalletError['code'], message: string) {
    super(message)
    this.code = code
  }
}

function provider(): Eip1193 {
  const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum
  if (!eth) throw new WalletError('no_wallet', '没检测到浏览器钱包（如 MetaMask / Coinbase Wallet）')
  return eth
}

async function ensureBaseSepolia(eth: Eip1193) {
  const chain = String(await eth.request({ method: 'eth_chainId' }))
  if (chain.toLowerCase() === BASE_SEPOLIA_HEX) return
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_SEPOLIA_HEX }] })
  } catch {
    throw new WalletError('wrong_chain', '请在钱包里切到 Base Sepolia 测试网')
  }
}

/** Turn a base64 PAYMENT-REQUIRED header into a base64 PAYMENT-SIGNATURE header. */
export async function signPaymentHeader(paymentRequired: string): Promise<{ header: string; payer: string }> {
  const eth = provider()
  const [{ createWalletClient, custom, getAddress }, { x402Client }, { ExactEvmScheme }, http] = await Promise.all([
    import('viem'),
    import('@x402/core/client'),
    import('@x402/evm/exact/client'),
    import('@x402/core/http'),
  ])
  let accounts: string[]
  try {
    accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[]
  } catch {
    throw new WalletError('rejected', '钱包拒绝了连接')
  }
  if (!accounts?.[0]) throw new WalletError('rejected', '钱包没有可用账户')
  await ensureBaseSepolia(eth)
  const address = getAddress(accounts[0])
  const wallet = createWalletClient({ account: address, transport: custom(eth) })
  const signer = {
    address,
    signTypedData: (message: Parameters<typeof wallet.signTypedData>[0]) => wallet.signTypedData({ ...message, account: address }),
  }
  const client = x402Client.fromConfig({
    schemes: [{ network: 'eip155:84532', client: new ExactEvmScheme(signer as never) }],
    spendControls: { maxAmountPerPayment: '$100' },
  })
  try {
    const payload = await client.createPaymentPayload(http.decodePaymentRequiredHeader(paymentRequired))
    return { header: http.encodePaymentSignatureHeader(payload), payer: address }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/reject|denied|cancel/i.test(msg)) throw new WalletError('rejected', '你在钱包里取消了签名')
    throw new WalletError('failed', `签名失败：${msg.slice(0, 120)}`)
  }
}
