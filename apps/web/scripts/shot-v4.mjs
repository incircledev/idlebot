import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const BASE = 'http://127.0.0.1:5190'
const OUT = '/workspace/screenshots'
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const context = await browser.newContext({ viewport: { width: 1100, height: 820 }, locale: 'zh-CN' })
await context.addInitScript(() => { localStorage.clear(); sessionStorage.clear() })
const page = await context.newPage()
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('.auth-hall-bg .quest-board-art')
await page.waitForTimeout(400)
await page.screenshot({ path: path.join(OUT, 'v4-login.png'), fullPage: true })
console.log('v4-login.png')

await page.getByRole('button', { name: '注册', exact: true }).click()
await page.getByPlaceholder('可选').fill('Alice')
await page.getByPlaceholder(/you@example.com/).fill('alice-v4@example.com')
await page.getByPlaceholder(/Demo/).fill('pass1234')
await page.locator('form.auth-card button[type="submit"]').click()
await page.waitForSelector('.hall.scene-v1 .quest-board-art')
await page.waitForSelector('.hall.scene-v1 .wood-floor')
await page.waitForTimeout(500)
await page.screenshot({ path: path.join(OUT, 'v4-hall.png'), fullPage: true })
console.log('v4-hall.png')
await browser.close()
