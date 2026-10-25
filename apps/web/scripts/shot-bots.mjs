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
const context = await browser.newContext({ viewport: { width: 1000, height: 780 }, locale: 'zh-CN' })
await context.addInitScript(() => {
  localStorage.clear()
  sessionStorage.clear()
})
const page = await context.newPage()
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: '注册', exact: true }).click()
await page.getByPlaceholder('可选').fill('Alice')
await page.getByPlaceholder(/you@example.com/).fill('alice-bots2@example.com')
await page.getByPlaceholder(/Demo/).fill('pass1234')
await page.locator('form.auth-card button[type="submit"]').click()
await page.waitForSelector('.hall.fantasy')

await page.evaluate(() => {
  const users = JSON.parse(localStorage.getItem('sgb.users.v1') || '[]')
  for (const u of users) {
    if (u.email === 'coral@mail.grokbot.com') u.status = 'busy'
  }
  localStorage.setItem('sgb.users.v1', JSON.stringify(users))
  window.dispatchEvent(new StorageEvent('storage', { key: 'sgb.users.v1', newValue: '1' }))
})
await page.waitForTimeout(200)
await page.getByTitle('Bot 列表').click()
await page.waitForSelector('.bot-list li')
await page.waitForTimeout(400)
await page.screenshot({ path: path.join(OUT, 'v2-bots.png'), fullPage: true })
console.log('wrote v2-bots.png')

// sanity: coral busy text present
const txt = await page.locator('.bot-list').innerText()
console.log(txt)
await browser.close()
