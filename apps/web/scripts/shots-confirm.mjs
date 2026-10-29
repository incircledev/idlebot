// Auth-screen shots against a Vite dev server in API mode (VITE_USE_API=1). Every /api call is stubbed.
// BASE (default x402 :5191), OUT, PREFIX ('' -> 2-unconfirmed-login / 2b-… / 3-link-failed; 'main-' -> main-2 / main-3).
import { chromium } from 'playwright'
const out = process.env.OUT ?? '/workspace/shots-confirm'
const U = process.env.BASE ?? 'http://127.0.0.1:5191/'
const main = process.env.PREFIX === 'main-'
const name = (n) => (main ? `main-${n[0]}${n[1] === 'b' ? 'b' : ''}.png` : `${n}.png`)
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const json = (status, body) => (r) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
const page = async () => {
  const ctx = await b.newContext({ viewport: { width: 1024, height: 640 }, deviceScaleFactor: 2, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
  const p = await ctx.newPage()
  await p.route('**/api/**', json(401, { error: 'Not signed in', code: 'unauthorized' }))
  await p.route('**/api/auth/register', json(202, { needsEmailConfirmation: true, email: 'newbie@example.com' }))
  await p.route('**/api/auth/login', json(403, { error: 'Email not confirmed', code: 'email_not_confirmed' }))
  await p.route('**/api/auth/resend', json(200, { sent: true }))
  return p
}
const fill = async (p) => {
  await p.getByPlaceholder('you@example.com').fill('newbie@example.com')
  await p.getByPlaceholder('至少 8 位').fill('demo12345')
  await p.locator('form button[type=submit]').click()
}
// 2: fresh visitor signs in before confirming -> inline orange 重新发送 link.
const p = await page()
await p.goto(U); await p.locator('form.auth').waitFor()
await p.locator('.seg-block').getByRole('button', { name: '登录', exact: true }).click()
await fill(p); await p.getByRole('button', { name: '重新发送', exact: true }).waitFor()
await p.screenshot({ path: `${out}/${name('2-unconfirmed-login')}` })
// 2b: click it -> toast + grey countdown.
await p.getByRole('button', { name: '重新发送', exact: true }).click()
await p.getByText('已重新发送，60 秒后可再发').waitFor(); await p.waitForTimeout(2200)
await p.screenshot({ path: `${out}/${name('2b-unconfirmed-cooldown')}` })
// 3: someone registered in this browser, then opens an expired link in a new tab.
const q = await page()
await q.goto(U); await q.locator('form.auth').waitFor()
await q.locator('.seg-block').getByRole('button', { name: '注册', exact: true }).click()
await fill(q); await q.waitForTimeout(800)
const r = await q.context().newPage()
await r.route('**/api/**', json(401, { error: 'Not signed in', code: 'unauthorized' }))
await r.goto(U + '?confirm=failed'); await r.locator('form.auth').waitFor(); await r.waitForTimeout(500)
await r.screenshot({ path: `${out}/${name('3-link-failed')}` })
console.log('tab:', await r.locator('.seg-block button.on').innerText(), 'email:', await r.getByPlaceholder('you@example.com').inputValue(), 'submit:', await r.locator('form button[type=submit]').innerText())
await b.close()
