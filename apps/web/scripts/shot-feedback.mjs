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
const context = await browser.newContext({ viewport: { width: 1000, height: 820 }, locale: 'zh-CN' })
await context.addInitScript(() => {
  localStorage.clear()
  sessionStorage.clear()
})
const page = await context.newPage()
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('.auth-card')
await page.waitForSelector('.auth-hall-bg')
await page.waitForTimeout(400)
await page.screenshot({ path: path.join(OUT, 'v2-login.png'), fullPage: true })
console.log('v2-login.png')

await page.getByRole('button', { name: '注册', exact: true }).click()
await page.getByPlaceholder('可选').fill('Alice')
await page.getByPlaceholder(/you@example.com/).fill('alice-fb@example.com')
await page.getByPlaceholder(/Demo/).fill('pass1234')
await page.locator('form.auth-card button[type="submit"]').click()
await page.waitForSelector('.hall.fantasy')
await page.waitForTimeout(400)
await page.screenshot({ path: path.join(OUT, 'v2-hall.png'), fullPage: true })
console.log('v2-hall.png')

// publish 3 tasks
async function publish(title, body) {
  await page.getByTitle('发布任务').click()
  await page.waitForSelector('.publish-form')
  await page.getByPlaceholder(/整理本周/).fill(title)
  await page.locator('textarea').fill(body)
  await page.getByRole('button', { name: '发布到公告板' }).click()
  await page.locator('.panel-close').click()
}
await publish('哥布林营地清剿', '清理东边营地，先到先得。')
await publish('寻找失落的矿石', '矿洞深处有遗失矿石。')
await publish('草药采集任务', '采集山谷草药十份。')

await page.getByRole('button', { name: '退出' }).click()
await page.waitForSelector('.auth-card')
await page.getByRole('button', { name: '注册', exact: true }).click()
await page.getByPlaceholder('可选').fill('Bob')
await page.getByPlaceholder(/you@example.com/).fill('bob-fb@example.com')
await page.getByPlaceholder(/Demo/).fill('pass1234')
await page.locator('form.auth-card button[type="submit"]').click()
await page.waitForSelector('.hall.fantasy')

await page.getByTitle('公告板').click()
await page.locator('.task-card.open', { hasText: '寻找失落的矿石' }).getByRole('button', { name: '接取' }).click()
await page.waitForTimeout(300)
await page.locator('.panel-close').click()

await page.getByTitle('公告板').click()
await page.locator('.task-card.open', { hasText: '草药采集任务' }).getByRole('button', { name: '接取' }).click()
await page.waitForTimeout(300)
await page.locator('.panel-close').click()

await page.getByTitle('我的任务').click()
page.once('dialog', async (d) => { await d.accept('获得：10份草药') })
await page.locator('.task-card.progress', { hasText: '草药采集任务' }).getByRole('button', { name: '提交结果' }).click()
await page.waitForSelector('.task-card.completed')
await page.waitForTimeout(300)
await page.screenshot({ path: path.join(OUT, 'v2-mytasks.png'), fullPage: true })
console.log('v2-mytasks.png')
await page.locator('.panel-close').click()

await page.getByTitle('公告板').click()
await page.waitForSelector('.task-card.progress')
await page.waitForTimeout(300)
await page.screenshot({ path: path.join(OUT, 'v2-board.png'), fullPage: true })
console.log('v2-board.png')

await browser.close()
console.log('done')
