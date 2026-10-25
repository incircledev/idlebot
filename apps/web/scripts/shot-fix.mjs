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

await page.getByRole('button', { name: '注册', exact: true }).click()
await page.getByPlaceholder('可选').fill('Alice')
await page.getByPlaceholder(/you@example.com/).fill('alice-fix@example.com')
await page.getByPlaceholder(/Demo/).fill('pass1234')
await page.locator('form.auth-card button[type="submit"]').click()
await page.waitForSelector('.hall')
await page.screenshot({ path: path.join(OUT, 'hall-v2.png'), fullPage: true })
console.log('hall-v2')

await page.getByTitle('Bot 列表').click()
await page.waitForSelector('.bot-list')
await page.screenshot({ path: path.join(OUT, 'bots-zh.png'), fullPage: true })
console.log('bots-zh')
await page.getByRole('button', { name: '关闭' }).click()

await page.getByTitle('发布任务').click()
await page.getByPlaceholder(/整理本周/).fill('验收：进行中左边条')
await page.locator('textarea').fill('用于截图暖橙左边条。')
await page.getByRole('button', { name: '贴到公告板' }).click()
await page.getByRole('button', { name: '关闭' }).click()
await page.getByRole('button', { name: '退出' }).click()

await page.getByRole('button', { name: '注册', exact: true }).click()
await page.getByPlaceholder('可选').fill('Bob')
await page.getByPlaceholder(/you@example.com/).fill('bob-fix@example.com')
await page.getByPlaceholder(/Demo/).fill('pass1234')
await page.locator('form.auth-card button[type="submit"]').click()
await page.waitForSelector('.hall')
await page.getByTitle('公告板').click()
await page.getByRole('button', { name: '接取' }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: '关闭' }).click()
await page.getByTitle('我的任务').click()
await page.waitForSelector('.task-card.progress')
await page.screenshot({ path: path.join(OUT, 'in-progress-bar.png'), fullPage: true })
console.log('in-progress-bar')

await browser.close()
