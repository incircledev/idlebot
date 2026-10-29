// Bounty P0 screenshots against the worktree stack: web :5191 -> API :3100 (X402_MOCK=1).
// Auth: local test API keys from KEYS_FILE. Wallet: a fake EIP-1193 provider whose
// eth_signTypedData_v4 is signed in Node with X402_PUBLISHER_PRIVATE_KEY (env only, never printed).
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { privateKeyToAccount } from 'viem/accounts'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5191'
const OUT = process.env.OUT ?? '/workspace/shots-bounty'
fs.mkdirSync(OUT, { recursive: true })
const keys = Object.fromEntries(
  fs.readFileSync(process.env.KEYS_FILE ?? '/tmp/idlebot-shots-keys.env', 'utf8').trim().split('\n')
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const raw = process.env.X402_PUBLISHER_PRIVATE_KEY?.trim()
if (!raw) throw new Error('X402_PUBLISHER_PRIVATE_KEY missing')
const signer = privateKeyToAccount(raw.startsWith('0x') ? raw : `0x${raw}`)

const browser = await chromium.launch({
  headless: true,
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const VIEW = { width: 1024, height: 640 }
const shot = async (page, name) => {
  await page.waitForTimeout(350)
  await page.screenshot({ path: path.join(OUT, name) })
  console.log('shot', name)
}

async function asUser(key) {
  const ctx = await browser.newContext({
    viewport: VIEW,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    extraHTTPHeaders: key ? { Authorization: `Bearer ${keys[key]}` } : {},
  })
  return ctx
}

// ---- publisher (小鹿) ----
const pub = await asUser('KEY_PUBLISHER')
let releaseSign
const signGate = new Promise((r) => (releaseSign = r))
let signedCount = 0
await pub.exposeFunction('__nodeSignTypedData', async (json) => {
  await signGate
  const td = JSON.parse(json)
  const { EIP712Domain: _drop, ...types } = td.types
  const msg = { ...td.message }
  for (const f of types[td.primaryType]) if (/^u?int/.test(f.type)) msg[f.name] = BigInt(msg[f.name])
  signedCount++
  return signer.signTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: msg })
})
await pub.addInitScript((address) => {
  window.ethereum = {
    isFake: true,
    async request({ method, params }) {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address]
      if (method === 'eth_chainId') return '0x14a34'
      if (method === 'wallet_switchEthereumChain') return null
      if (method === 'eth_signTypedData_v4') return window.__nodeSignTypedData(params[1])
      throw new Error(`fake wallet: ${method} unsupported`)
    },
  }
}, signer.address)
const page = await pub.newPage()
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('.row')

// 1. publish form with a bounty
await page.getByRole('button', { name: '＋ 发布任务' }).click()
await page.getByPlaceholder('例如：把 CSV 画成月度趋势图').fill('统计 10 月活跃用户')
await page.getByPlaceholder('要做什么、交付什么').fill('从埋点表导出 10 月 DAU/MAU，画一张折线图。')
await page.locator('.inp.suffix input').fill('5')
await shot(page, '1-publish.png')

// 2. paying: wallet asked to sign (held)
await page.getByRole('button', { name: '支付 5 USDC 并发布' }).click()
await page.getByText('等待钱包签名…').waitFor()
await shot(page, '2-paying.png')
releaseSign()
await page.getByText('已支付 5 USDC，任务已发布').waitFor({ timeout: 15000 })
console.log('paid publish ok; browser signatures:', signedCount)

// 3. hall with 有赏金 filter
await page.locator('.foot .pill', { hasText: '有赏金' }).click()
await shot(page, '3-hall-bounty.png')
await page.locator('.foot .pill', { hasText: '全部' }).click()
await shot(page, '3b-hall-all.png')

await page.locator('.toast').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
// 4. my tasks -> pending review panel
await page.getByRole('button', { name: '我的任务' }).click()
await page.locator('.row', { hasText: '翻译 README 为英文' }).getByRole('button', { name: '验收' }).click()
await page.locator('.review').waitFor()
await shot(page, '4-pending-review.png')

// 5. reject dialog with the empty-reason error
await page.locator('.review').getByRole('button', { name: '驳回' }).click()
await page.getByRole('button', { name: '确认驳回' }).click()
await page.getByText('请写驳回原因').waitFor()
await shot(page, '5-reject.png')
await page.locator('.dialog').getByRole('button', { name: '取消' }).click()

// 6. receipt for the paid task
await page.locator('.row', { hasText: '写一条发布推文' }).getByRole('button', { name: '收据' }).click()
await page.locator('.rc-row .bty').first().waitFor()
await shot(page, '6-receipt.png')
await page.locator('.dialog .btn.sec', { hasText: '关闭' }).click()
await page.locator('.row', { hasText: '查 3 家竞品定价' }).getByRole('button', { name: '收据' }).click()
await page.locator('.rc-row', { hasText: '退款' }).waitFor()
await shot(page, '6b-receipt-refund.png')
await pub.close()

// ---- bot03 without a wallet ----
const nw = await asUser('KEY_NOWALLET')
const p2 = await nw.newPage()
await p2.goto(BASE, { waitUntil: 'networkidle' })
await p2.locator('.row', { hasText: '给 landing page 写 3 版标题' }).getByRole('button', { name: '领取' }).click()
await p2.getByText('去填写').click()
await p2.locator('.dialog input.mono').fill('0x12ab34')
await p2.getByRole('button', { name: '保存' }).click()
await p2.getByText('地址格式不对，应为 0x 开头的 42 位').waitFor()
await shot(p2, '7-wallet.png')
await nw.close()

// ---- e1: signup -> confirmation mail sent (register intercepted: no real Supabase signup) ----
const anon = await asUser(null)
await anon.route('**/api/auth/register', (route) =>
  route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ needsEmailConfirmation: true, email: 'bot01@mail.grokbot.com' }) }),
)
const p3 = await anon.newPage()
await p3.goto(BASE, { waitUntil: 'networkidle' })
await p3.getByRole('button', { name: '注册', exact: true }).click()
await p3.getByPlaceholder('you@example.com').fill('bot01@mail.grokbot.com')
await p3.locator('input[type="password"]').fill('pass12345')
await p3.getByRole('button', { name: '注册并进入' }).click()
await p3.getByText('验证邮件已发送').waitFor()
await p3.waitForTimeout(1700)
await shot(p3, '8-email-sent.png')
await anon.close()
await browser.close()
