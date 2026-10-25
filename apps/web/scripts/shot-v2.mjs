import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const BASE = 'http://127.0.0.1:5190'
const OUT = '/workspace/screenshots/shared-grok-bot'
fs.mkdirSync(OUT, { recursive: true })

async function shot(page, name) {
  const file = path.join(OUT, name)
  await page.screenshot({ path: file, fullPage: true })
  console.log('wrote', name)
}

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
await page.waitForSelector('.wordmark')
await shot(page, 'v2-login.png')

await page.getByRole('button', { name: '注册', exact: true }).click()
await page.getByPlaceholder('可选').fill('Alice')
await page.getByPlaceholder(/you@example.com/).fill('alice-v2@example.com')
await page.getByPlaceholder(/Demo/).fill('pass1234')
await page.locator('form.auth-card button[type="submit"]').click()
await page.waitForSelector('.hall.fantasy')
await shot(page, 'v2-hall.png')

// Publish task A (will stay open for board 3-state later we need open+progress+completed)
await page.getByTitle('发布任务').click()
await page.waitForSelector('.publish-form')
await shot(page, 'v2-publish.png')
await page.getByPlaceholder(/整理本周/).fill('哥布林营地清剿')
await page.locator('textarea').fill('清理东边营地，先到先得。')
await page.getByRole('button', { name: '发布到公告板' }).click()
await page.getByRole('button', { name: '×' }).click().catch(() => page.locator('.panel-close').click())

// Publish task B
await page.getByTitle('发布任务').click()
await page.getByPlaceholder(/整理本周/).fill('寻找失落的矿石')
await page.locator('textarea').fill('矿洞深处有遗失矿石。')
await page.getByRole('button', { name: '发布到公告板' }).click()
await page.locator('.panel-close').click()

// Publish task C
await page.getByTitle('发布任务').click()
await page.getByPlaceholder(/整理本周/).fill('草药采集任务')
await page.locator('textarea').fill('采集山谷草药十份。')
await page.getByRole('button', { name: '发布到公告板' }).click()
await page.locator('.panel-close').click()

await page.getByRole('button', { name: '退出' }).click()
await page.waitForSelector('.auth-card')

// Bob claims B and completes C path separately — claim B (progress), claim C then complete
await page.getByRole('button', { name: '注册', exact: true }).click()
await page.getByPlaceholder('可选').fill('Bob')
await page.getByPlaceholder(/you@example.com/).fill('bob-v2@example.com')
await page.getByPlaceholder(/Demo/).fill('pass1234')
await page.locator('form.auth-card button[type="submit"]').click()
await page.waitForSelector('.hall')

await page.getByTitle('公告板').click()
// claim 寻找失落的矿石
await page.locator('.task-card.open', { hasText: '寻找失落的矿石' }).getByRole('button', { name: '接取' }).click()
await page.waitForTimeout(400)
await page.locator('.panel-close').click()

await page.getByTitle('公告板').click()
await page.locator('.task-card.open', { hasText: '草药采集任务' }).getByRole('button', { name: '接取' }).click()
await page.waitForTimeout(400)
await page.locator('.panel-close').click()

await page.getByTitle('我的任务').click()
page.once('dialog', async (d) => { await d.accept('获得：10份草药') })
await page.locator('.task-card.progress', { hasText: '草药采集任务' }).getByRole('button', { name: '提交结果' }).click()
await page.waitForSelector('.task-card.completed')
await shot(page, 'v2-mytasks.png')
await page.locator('.panel-close').click()

// Board with 3 states (Alice's open + Bob's progress + completed visible under 其它状态)
await page.getByTitle('公告板').click()
await page.waitForSelector('.task-card')
await shot(page, 'v2-board.png')
await page.locator('.panel-close').click()

// Make a bot busy: logout, login as pixel, claim remaining open task briefly — OR set storage
await page.getByRole('button', { name: '退出' }).click()
await page.locator('.tabs button', { hasText: '登录' }).click()
await page.getByPlaceholder(/you@example.com/).fill('pixel@mail.grokbot.com')
await page.getByPlaceholder(/Demo/).fill('demo1234')
await page.locator('form.auth-card button[type="submit"]').click()
await page.waitForSelector('.hall')
await page.getByTitle('公告板').click()
const claimBtn = page.getByRole('button', { name: '接取' }).first()
if (await claimBtn.count()) {
  // For bot, claim auto-completes via relay — so set busy manually in storage instead
}
await page.locator('.panel-close').click()

// Force Coral busy via localStorage for visual
await page.evaluate(() => {
  const users = JSON.parse(localStorage.getItem('sgb.users.v1') || '[]')
  const coral = users.find((u) => u.email === 'coral@mail.grokbot.com')
  if (coral) coral.status = 'busy'
  localStorage.setItem('sgb.users.v1', JSON.stringify(users))
})
await page.reload({ waitUntil: 'networkidle' })
// stay logged in as pixel after reload? sessionStorage cleared on reload? session persists in same page reload
await page.waitForTimeout(300)
// if logged out, login again
if (await page.locator('.auth-card').count()) {
  await page.locator('.tabs button', { hasText: '登录' }).click()
  await page.getByPlaceholder(/you@example.com/).fill('alice-v2@example.com')
  await page.getByPlaceholder(/Demo/).fill('pass1234')
  await page.locator('form.auth-card button[type="submit"]').click()
  await page.waitForSelector('.hall')
}
await page.getByTitle('Bot 列表').click()
await page.waitForSelector('.bot-list')
await shot(page, 'v2-bots.png')

await browser.close()
console.log('all v2 shots done')
