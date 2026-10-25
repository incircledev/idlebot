import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5190'
const OUT = '/workspace/screenshots/shared-grok-bot'
fs.mkdirSync(OUT, { recursive: true })

async function shot(page, name) {
  const file = path.join(OUT, name)
  await page.screenshot({ path: file, fullPage: true })
  console.log('wrote', file)
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

const context = await browser.newContext({
  viewport: { width: 960, height: 720 },
  locale: 'zh-CN',
})
await context.addInitScript(() => {
  localStorage.clear()
  sessionStorage.clear()
})

const page = await context.newPage()
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('h1')
await shot(page, 'login.png')

await page.getByRole('button', { name: '注册', exact: true }).click()
await page.getByPlaceholder('可选').fill('Alice')
await page.getByPlaceholder(/you@example.com/).fill('alice@example.com')
await page.getByPlaceholder(/Demo/).fill('pass1234')
await page.getByRole('button', { name: '注册并进入公会' }).click()
await page.waitForSelector('.hall')
await shot(page, 'hall.png')

await page.getByTitle('Bot 列表').click()
await page.waitForSelector('.bot-list')
await shot(page, 'bots.png')
await page.getByRole('button', { name: '关闭' }).click()

await page.getByTitle('发布任务').click()
await page.getByPlaceholder(/整理本周/).fill('整理本周邮件摘要')
await page.locator('textarea').fill('请把本周重要邮件整理成三条要点。')
await page.getByRole('button', { name: '贴到公告板' }).click()
await page.waitForSelector('.task-card.open')
await shot(page, 'board-open.png')
await page.getByRole('button', { name: '关闭' }).click()

await page.getByTitle('我的任务').click()
await page.waitForSelector('.task-card')
await shot(page, 'my-tasks-alice.png')
await page.getByRole('button', { name: '关闭' }).click()

await page.getByRole('button', { name: '退出' }).click()
await page.waitForSelector('.auth-card')

await page.getByRole('button', { name: '注册', exact: true }).click()
await page.getByPlaceholder('可选').fill('Bob')
await page.getByPlaceholder(/you@example.com/).fill('bob@example.com')
await page.getByPlaceholder(/Demo/).fill('pass1234')
await page.getByRole('button', { name: '注册并进入公会' }).click()
await page.waitForSelector('.hall')

await page.getByTitle('公告板').click()
await page.waitForSelector('.task-card.open')
await shot(page, 'board.png')
await page.getByRole('button', { name: '接取' }).click()
await page.waitForTimeout(500)
await page.getByRole('button', { name: '关闭' }).click()

await page.getByTitle('我的任务').click()
await page.waitForSelector('.task-card.progress')
await shot(page, 'in-progress.png')

page.once('dialog', async (d) => {
  await d.accept('人工完成：三条要点已整理完毕。')
})
await page.getByRole('button', { name: '提交结果' }).click()
await page.waitForSelector('.task-card.completed')
await shot(page, 'completed.png')
await page.getByRole('button', { name: '关闭' }).click()
await shot(page, 'my-tasks.png')

// Bot claim + relay auto-complete (same storage, new session via logout)
await page.getByRole('button', { name: '退出' }).click()
await page.waitForSelector('.auth-card')
await page.getByRole('button', { name: '注册', exact: true }).click()
await page.getByPlaceholder('可选').fill('Carol')
await page.getByPlaceholder(/you@example.com/).fill('carol@example.com')
await page.getByPlaceholder(/Demo/).fill('pass1234')
await page.getByRole('button', { name: '注册并进入公会' }).click()
await page.waitForSelector('.hall')
await page.getByTitle('发布任务').click()
await page.getByPlaceholder(/整理本周/).fill('Bot 接力测试任务')
await page.locator('textarea').fill('请 Bot 通过邮件中继处理。')
await page.getByRole('button', { name: '贴到公告板' }).click()
await page.getByRole('button', { name: '关闭' }).click()
await page.getByRole('button', { name: '退出' }).click()
await page.waitForSelector('.auth-card')

await page.locator('.tabs button', { hasText: '登录' }).click()
await page.getByPlaceholder(/you@example.com/).fill('pixel@mail.grokbot.com')
await page.getByPlaceholder(/Demo/).fill('demo1234')
await page.locator('form.auth-card button[type="submit"]').click()
await page.waitForSelector('.hall')
await page.getByTitle('公告板').click()
await page.getByRole('button', { name: '接取' }).first().click()
await page.waitForTimeout(1200)
await page.getByRole('button', { name: '关闭' }).click()
await page.getByTitle('我的任务').click()
await page.waitForSelector('.task-card.completed')
await shot(page, 'bot-completed.png')

await browser.close()
console.log('done')
