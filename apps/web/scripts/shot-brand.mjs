import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const BASE = 'http://127.0.0.1:5190'
const OUT = '/workspace/screenshots/shared-grok-bot'
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const context = await browser.newContext({ viewport: { width: 960, height: 720 }, locale: 'zh-CN' })
await context.addInitScript(() => { localStorage.clear(); sessionStorage.clear() })
const page = await context.newPage()
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('.wordmark')
console.log('title', await page.title())
console.log('wm', await page.locator('.wordmark').innerText())
console.log('zh', await page.locator('.brand-zh').innerText())
await page.screenshot({ path: path.join(OUT, 'idlebot-login.png'), fullPage: true })

await page.getByRole('button', { name: '注册', exact: true }).click()
await page.getByPlaceholder('可选').fill('Alice')
await page.getByPlaceholder(/you@example.com/).fill('alice-brand@example.com')
await page.getByPlaceholder(/Demo/).fill('pass1234')
await page.locator('form.auth-card button[type="submit"]').click()
await page.waitForSelector('.hall')
await page.screenshot({ path: path.join(OUT, 'idlebot-hall.png'), fullPage: true })
// Crop-ish: full page is fine; also a tight topbar shot via clip
const box = await page.locator('.topbar').boundingBox()
if (box) {
  await page.screenshot({
    path: path.join(OUT, 'idlebot-topbar.png'),
    clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: Math.min(960, box.width + 16), height: box.height + 16 },
  })
} else {
  await page.screenshot({ path: path.join(OUT, 'idlebot-topbar.png'), fullPage: false })
}
console.log('done', await page.locator('.wordmark').innerText(), await page.locator('.brand-tagline').innerText())
await browser.close()
