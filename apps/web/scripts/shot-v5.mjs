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
const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, locale: 'zh-CN' })
await context.addInitScript(() => { localStorage.clear(); sessionStorage.clear() })
const page = await context.newPage()
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('.auth-hall-bg .hall-bg-art')
await page.waitForTimeout(500)
await page.screenshot({ path: path.join(OUT, 'v5-login.png'), fullPage: true })
console.log('v5-login.png')

await page.getByRole('button', { name: '注册', exact: true }).click()
await page.getByPlaceholder('可选').fill('Alice')
await page.getByPlaceholder(/you@example.com/).fill('alice-v5@example.com')
await page.getByPlaceholder(/Demo/).fill('pass1234')
await page.locator('form.auth-card button[type="submit"]').click()
await page.waitForSelector('.hall.scene-v2 .hall-bg-art')
await page.waitForSelector('.hall.scene-v2 .publish-sign-art')
await page.waitForTimeout(600)
// assert no duplicate publish label under plaque
const labels = await page.locator('.hotspot.publish-plaque .hotspot-label').count()
const textDup = await page.locator('.hotspot.publish-plaque').innerText()
console.log('publish labels', labels, 'text', JSON.stringify(textDup.trim()))
await page.screenshot({ path: path.join(OUT, 'v5-hall.png'), fullPage: true })
console.log('v5-hall.png')
await browser.close()
