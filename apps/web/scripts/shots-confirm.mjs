// x402-proto variant of confirm.mjs: web :5191 (worktree), e1 screen 「验证邮件已发送」 + 60 s cooldown.
import { chromium } from 'playwright'
const out = process.env.OUT ?? '/workspace/shots-confirm'
const U = process.env.BASE ?? 'http://127.0.0.1:5191/'
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 1024, height: 640 }, deviceScaleFactor: 2, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
const stub = async (p) => {
  await p.route('**/api/auth/register', (r) => r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ needsEmailConfirmation: true, email: 'newbie@example.com' }) }))
  await p.route('**/api/auth/login', (r) => r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Email not confirmed', code: 'email_not_confirmed' }) }))
  await p.route('**/api/auth/resend', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sent: true }) }))
}
const login = async (p) => {
  await p.locator('form.auth').getByRole('button', { name: '登录', exact: true }).first().click()
  await p.getByPlaceholder('you@example.com').fill('newbie@example.com'); await p.getByPlaceholder('至少 8 位').fill('demo12345')
  await p.locator('form button[type=submit]').click(); await p.getByText('重新发送确认邮件').waitFor()
}
const p = await ctx.newPage(); await stub(p)
await p.goto(U); await p.locator('form.auth').waitFor()
await p.locator('form.auth').getByRole('button', { name: '注册', exact: true }).first().click()
await p.getByPlaceholder('you@example.com').fill('newbie@example.com'); await p.getByPlaceholder('至少 8 位').fill('demo12345')
await p.locator('form button[type=submit]').click(); await p.getByText('验证邮件已发送').waitFor()
await p.waitForTimeout(1500)
await p.screenshot({ path: `${out}/1-pending.png` })
await p.getByText('换个邮箱').click(); await p.locator('form.auth').waitFor()
await login(p); await p.waitForTimeout(300)
await p.screenshot({ path: `${out}/2-unconfirmed-login.png` })
await p.goto(U + '?confirm=failed'); await p.waitForTimeout(500)
await p.screenshot({ path: `${out}/3-link-failed.png` })
// Extra: a fresh visitor (no cooldown yet) resends from the login screen -> toast + countdown.
const p2 = await ctx.newPage(); await stub(p2)
await p2.goto(U); await p2.locator('form.auth').waitFor(); await login(p2)
await p2.getByRole('button', { name: '重新发送确认邮件' }).click()
await p2.getByText('已重新发送，60 秒后可再发').waitFor(); await p2.waitForTimeout(1200)
await p2.screenshot({ path: `${out}/4-resend-toast.png` })
await b.close()
console.log('ok')
