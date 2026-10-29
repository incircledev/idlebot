/**
 * Hall data access. Dev uses the mock store unless `VITE_USE_API=1`.
 * Production builds use the cookie session on same-origin `/api`.
 */
import type { PublicLedgerEntry, PublicTask, PublicUser } from '@idlebot/contract'
import { ApiClientError, remoteApi, useRemoteApi } from './apiClient'
import * as mock from './store'
import { BOT_COLORS, BOT_SHAPES, type Account, type BotShape, type Task } from './types'

export const remoteMode = useRemoteApi

const CACHE_KEY = 'sgb.remote-users.v1'

export type HallSnapshot = {
  me: Account | null
  bots: Account[]
  openTasks: Task[]
  allTasks: Task[]
  myTasks: Task[]
  directory: Record<string, Account>
}

export type HallResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string }

/** Sign-up accepted, but the email must be confirmed before the first sign-in. */
export type PendingConfirmation = { pendingEmail: string }

type CachedUser = {
  id: string
  email: string
  kind: Account['kind']
  name: string
  displayName?: string
  status: Account['status']
  createdAt: string
  shape?: BotShape
  color?: string
}

function hashIndex(id: string): number {
  let n = 0
  for (let i = 0; i < id.length; i++) n = (n + id.charCodeAt(i)) % BOT_SHAPES.length
  return n
}

export function accountFromUser(user: PublicUser): Account {
  const idx = hashIndex(user.id)
  const bot = user.kind === 'bot'
  return {
    id: user.id,
    email: user.email,
    password: '',
    kind: user.kind,
    name: user.displayName || user.name,
    displayName: user.displayName,
    status: user.status,
    shape: bot ? BOT_SHAPES[idx] : undefined,
    color: bot ? BOT_COLORS[idx] : undefined,
    createdAt: user.createdAt,
    walletAddress: user.walletAddress,
  }
}

function taskFromPublic(task: PublicTask): Task {
  return {
    id: task.id,
    title: task.title,
    body: task.body,
    publisherId: task.publisherId,
    assigneeId: task.assigneeId,
    status: task.status,
    result: task.result,
    createdAt: task.createdAt,
    claimedAt: task.claimedAt,
    completedAt: task.completedAt,
    bounty: task.bounty,
    rejectCount: task.rejectCount,
    rejectReason: task.rejectReason,
    submittedAt: task.submittedAt,
    autoAcceptAt: task.autoAcceptAt,
    cancelledAt: task.cancelledAt,
    payoutStatus: task.payoutStatus,
  }
}

function placeholder(id: string): Account {
  return {
    id,
    email: '',
    password: '',
    kind: 'human',
    name: `用户 ${id.slice(0, 6)}`,
    status: null,
    createdAt: '',
  }
}

function readCache(): Record<string, Account> {
  try {
    const raw = JSON.parse(sessionStorage.getItem(CACHE_KEY) || '{}') as Record<string, CachedUser>
    const directory: Record<string, Account> = {}
    for (const row of Object.values(raw)) {
      if (!row?.id || !row.email) continue
      directory[row.id] = { ...row, password: '' }
    }
    return directory
  } catch {
    return {}
  }
}

function writeCache(directory: Record<string, Account>) {
  const slim: Record<string, CachedUser> = {}
  for (const row of Object.values(directory)) {
    if (!row.email) continue
    slim[row.id] = {
      id: row.id,
      email: row.email,
      kind: row.kind,
      name: row.name,
      displayName: row.displayName,
      status: row.status,
      createdAt: row.createdAt,
      shape: row.shape,
      color: row.color,
    }
  }
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(slim))
  } catch {
    // The board still renders; names fall back to short ids.
  }
}

function remember(account: Account) {
  const directory = readCache()
  directory[account.id] = account
  writeCache(directory)
}

const RULES: Array<[RegExp, string]> = [
  [/Bot email must be/i, 'Bot 邮箱必须是 *@mail.grokbot.com'],
  [/Invalid email or password/i, '邮箱或密码错误'],
  [/User already exists/i, '该邮箱已注册'],
  [/Password must be|Password too short|Password too long/i, '密码需要 8 到 128 位'],
  [/Invalid email/i, '邮箱格式不正确'],
  [/title and body are required/i, '请填写标题和简述'],
  [/result is required/i, '请填写任务结果'],
  [/Unauthorized/i, '未登录'],
  [/different result/i, '任务已完成，且结果不一致'],
  [/Illegal status transition/i, '任务状态已变化，请刷新后再试'],
  [/Task not found/i, '任务不存在'],
  [/Could not register/i, '注册失败'],
  [/Could not sign in/i, '登录失败'],
  [/payout wallet address/i, '领取带赏金的任务前，请先填写收款钱包地址'],
  [/walletAddress must be/i, '地址格式不对，应为 0x 开头的 42 位'],
  [/bounty must be/i, '赏金范围 0.01–100 测试 USDC'],
  [/insufficient_balance|exceeds balance/i, '钱包里的测试 USDC 不够'],
  [/Only the publisher/i, '只有发布者可以操作'],
  [/reject reason|reason is required/i, '请写驳回原因'],
  [/Already rejected/i, '已驳回 2 次，只能通过'],
  [/Only open tasks can be cancelled/i, '只有还没人领取的任务可以取消'],
  [/not configured \(X402/i, '赏金支付还没配置好（服务端缺少平台钱包）'],
  [/Failed to fetch|NetworkError|Load failed/i, '无法连接 API。请先在 127.0.0.1:3000 启动 apps/api'],
]

function localize(message: string): string {
  for (const [rule, text] of RULES) {
    if (rule.test(message)) return text
  }
  return message
}

function explain(err: unknown, fallback: string): string {
  if (err instanceof ApiClientError) {
    const text = localize(err.message || fallback)
    if (err.taskStatus && !text.includes(err.taskStatus)) return `${text}（${err.taskStatus}）`
    return text
  }
  if (err instanceof Error && err.message) return localize(err.message)
  return fallback
}

function byNewest(a: Task, b: Task): number {
  return b.createdAt.localeCompare(a.createdAt)
}

function mockSnapshot(): HallSnapshot {
  mock.ensureSeedBots()
  const me = mock.getMe()
  const directory: Record<string, Account> = {}
  for (const user of mock.listBots()) directory[user.id] = user
  if (me) directory[me.id] = me
  const allTasks = mock.listAllTasks()
  for (const task of allTasks) {
    const publisher = mock.getAccount(task.publisherId)
    if (publisher) directory[publisher.id] = publisher
    if (task.assigneeId) {
      const assignee = mock.getAccount(task.assigneeId)
      if (assignee) directory[assignee.id] = assignee
    }
  }
  return {
    me,
    bots: mock.listBots(),
    openTasks: mock.listOpenTasks(),
    allTasks,
    myTasks: me ? mock.listMyTasks(me.id) : [],
    directory,
  }
}

async function remoteSnapshot(): Promise<HallSnapshot> {
  let me: Account | null = null
  try {
    me = accountFromUser(await remoteApi.me())
  } catch (err) {
    if (!(err instanceof ApiClientError) || err.status !== 401) throw err
  }
  const directory = readCache()
  if (!me) {
    return { me: null, bots: [], openTasks: [], allTasks: [], myTasks: [], directory }
  }
  directory[me.id] = me
  const [people, open, progress, review, done, cancelled, mine] = await Promise.all([
    remoteApi.users(),
    remoteApi.tasks('open'),
    remoteApi.tasks('in_progress'),
    remoteApi.tasks('pending_review'),
    remoteApi.tasks('completed'),
    remoteApi.tasks('cancelled'),
    remoteApi.mine(),
  ])
  for (const person of people.items) directory[person.id] = accountFromUser(person)
  directory[me.id] = me
  const merged = new Map<string, Task>()
  for (const item of [...open.items, ...progress.items, ...review.items, ...done.items, ...cancelled.items, ...mine.items]) {
    merged.set(item.id, taskFromPublic(item))
  }
  const allTasks = [...merged.values()].sort(byNewest)
  for (const task of allTasks) {
    if (!directory[task.publisherId]) directory[task.publisherId] = placeholder(task.publisherId)
    if (task.assigneeId && !directory[task.assigneeId]) {
      directory[task.assigneeId] = placeholder(task.assigneeId)
    }
  }
  writeCache(directory)
  const bots = Object.values(directory)
    .filter((user) => user.kind === 'bot' && user.email)
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    me,
    bots,
    openTasks: allTasks.filter((task) => task.status === 'open'),
    allTasks,
    myTasks: mine.items.map(taskFromPublic).sort(byNewest),
    directory,
  }
}

export async function loadHall(): Promise<HallResult<HallSnapshot>> {
  try {
    const data = remoteMode ? await remoteSnapshot() : mockSnapshot()
    return { ok: true, data }
  } catch (err) {
    return { ok: false, error: explain(err, '无法加载大厅') }
  }
}

export async function registerAccount(
  email: string,
  password: string,
  name?: string,
): Promise<HallResult<Account | PendingConfirmation>> {
  if (!remoteMode) {
    const res = mock.register(email, password, name)
    return res.ok ? { ok: true, data: res.user } : { ok: false, error: res.error }
  }
  if (password.length < 8 || password.length > 128) {
    return { ok: false, error: '密码需要 8 到 128 位' }
  }
  try {
    const displayName = name?.trim() || undefined
    const res = await remoteApi.register({
      email: email.trim(),
      password,
      displayName,
      name: displayName,
    })
    if ('needsEmailConfirmation' in res) return { ok: true, data: { pendingEmail: res.email } }
    const account = accountFromUser(res.user)
    remember(account)
    return { ok: true, data: account }
  } catch (err) {
    return { ok: false, error: explain(err, '注册失败') }
  }
}

export async function loginAccount(email: string, password: string): Promise<HallResult<Account>> {
  if (!remoteMode) {
    const res = mock.login(email, password)
    return res.ok ? { ok: true, data: res.user } : { ok: false, error: res.error }
  }
  try {
    const res = await remoteApi.login(email.trim(), password)
    const account = accountFromUser(res.user)
    remember(account)
    return { ok: true, data: account }
  } catch (err) {
    if (err instanceof ApiClientError && err.code === 'email_not_confirmed') {
      return { ok: false, error: '邮箱还没确认，请先点确认邮件里的链接', code: err.code }
    }
    return { ok: false, error: explain(err, '登录失败') }
  }
}

export async function resendConfirmation(email: string): Promise<HallResult<null>> {
  try {
    await remoteApi.resendConfirmation(email.trim())
    return { ok: true, data: null }
  } catch (err) {
    return { ok: false, error: explain(err, '发送失败，请稍后再试') }
  }
}

export async function logoutAccount(): Promise<HallResult<null>> {
  if (!remoteMode) {
    mock.logout()
    return { ok: true, data: null }
  }
  try {
    await remoteApi.signOut()
    return { ok: true, data: null }
  } catch (err) {
    if (err instanceof ApiClientError && (err.status === 400 || err.status === 401)) {
      return { ok: true, data: null }
    }
    return { ok: false, error: explain(err, '退出失败') }
  }
}

export type PublishStage = 'requesting' | 'signing' | 'settling'

/**
 * Publish. A bounty runs the x402 flow: POST -> 402 -> wallet signs -> POST with PAYMENT-SIGNATURE.
 * The task only exists (open) after the platform wallet has been paid.
 */
export async function publish(
  title: string,
  body: string,
  bounty = '',
  onStage?: (stage: PublishStage) => void,
): Promise<HallResult<Task>> {
  const amount = bounty.trim()
  if (!remoteMode) {
    if (amount && Number(amount) !== 0) return { ok: false, error: '赏金需要连接 API（VITE_USE_API=1）' }
    const res = mock.publishTask(title, body)
    return res.ok ? { ok: true, data: res.task } : { ok: false, error: res.error }
  }
  if (!title.trim() || !body.trim()) return { ok: false, error: '请填写标题和简述' }
  const req = { title: title.trim(), body: body.trim(), ...(amount ? { bounty: amount } : {}) }
  try {
    onStage?.('requesting')
    const first = await remoteApi.createTaskX402(req)
    if (first.kind === 'created') return { ok: true, data: taskFromPublic(first.task) }
    onStage?.('signing')
    const { signPaymentHeader } = await import('./wallet')
    const signed = await signPaymentHeader(first.header)
    onStage?.('settling')
    const second = await remoteApi.createTaskX402(req, signed.header)
    if (second.kind === 'created') return { ok: true, data: taskFromPublic(second.task) }
    return { ok: false, error: localize(second.message || second.error || '支付没有成功'), code: second.error }
  } catch (err) {
    return { ok: false, error: explain(err, '发布失败') }
  }
}

async function taskCall(fn: () => Promise<PublicTask>, fallback: string): Promise<HallResult<Task>> {
  try {
    return { ok: true, data: taskFromPublic(await fn()) }
  } catch (err) {
    return { ok: false, error: explain(err, fallback), code: err instanceof ApiClientError ? err.code : undefined }
  }
}

export const acceptTask = (id: string) => taskCall(() => remoteApi.accept(id), '验收失败')
export const rejectTask = (id: string, reason: string) => taskCall(() => remoteApi.reject(id, reason), '驳回失败')
export const cancelTask = (id: string) => taskCall(() => remoteApi.cancel(id), '取消失败')

export async function loadReceipt(id: string): Promise<HallResult<PublicLedgerEntry[]>> {
  try {
    return { ok: true, data: (await remoteApi.receipt(id)).items }
  } catch (err) {
    return { ok: false, error: explain(err, '读取收据失败') }
  }
}

export async function saveWallet(address: string): Promise<HallResult<Account>> {
  try {
    const account = accountFromUser(await remoteApi.updateWallet(address.trim() || null))
    remember(account)
    return { ok: true, data: account }
  } catch (err) {
    return { ok: false, error: explain(err, '保存失败') }
  }
}

export async function claim(taskId: string): Promise<HallResult<{ task: Task; autoCompleted: boolean }>> {
  if (!remoteMode) {
    const res = mock.claimTask(taskId)
    if (!res.ok) return { ok: false, error: res.error }
    const me = mock.getMe()
    if (me?.kind === 'bot') {
      const relay = await mock.afterClaimRelay(res.task)
      if (relay.previewReply) {
        const done = mock.completeTask(taskId, relay.previewReply)
        if (!done.ok) return { ok: false, error: done.error }
        return { ok: true, data: { task: done.task, autoCompleted: true } }
      }
      if (relay.error) return { ok: false, error: relay.error }
    }
    return { ok: true, data: { task: res.task, autoCompleted: false } }
  }

  let claimed: Task
  try {
    claimed = taskFromPublic(await remoteApi.claim(taskId))
  } catch (err) {
    return {
      ok: false,
      error: explain(err, '接取失败'),
      code: err instanceof ApiClientError ? err.code : undefined,
    }
  }

  let me: Account
  try {
    me = accountFromUser(await remoteApi.me())
    remember(me)
  } catch (err) {
    return { ok: false, error: explain(err, '已接取，但读取会话失败') }
  }
  if (me.kind !== 'bot') return { ok: true, data: { task: claimed, autoCompleted: false } }

  try {
    remember(accountFromUser(await remoteApi.updateStatus('busy')))
  } catch {
    // Claim already succeeded. Idle/busy is display state.
  }
  try {
    const result = `Bot 已处理「${claimed.title}」。`
    const done = taskFromPublic(await remoteApi.mockComplete({ taskId, result }))
    try {
      remember(accountFromUser(await remoteApi.updateStatus('idle')))
    } catch {
      // The task row is already completed.
    }
    return { ok: true, data: { task: done, autoCompleted: true } }
  } catch (err) {
    return { ok: false, error: `已接取，自动完成失败：${explain(err, '请在我的任务里提交结果')}` }
  }
}

export async function complete(taskId: string, result: string): Promise<HallResult<Task>> {
  if (!remoteMode) {
    const res = mock.completeTask(taskId, result)
    return res.ok ? { ok: true, data: res.task } : { ok: false, error: res.error }
  }
  if (!result.trim()) return { ok: false, error: '请填写任务结果' }
  try {
    const task = taskFromPublic(await remoteApi.complete(taskId, { result: result.trim() }))
    try {
      const me = accountFromUser(await remoteApi.me())
      if (me.kind === 'bot') remember(accountFromUser(await remoteApi.updateStatus('idle')))
      else remember(me)
    } catch {
      // Completion is already stored.
    }
    return { ok: true, data: task }
  } catch (err) {
    return { ok: false, error: explain(err, '完成失败') }
  }
}

export function lookup(directory: Record<string, Account>, id: string | null | undefined): Account | null {
  if (!id) return null
  return directory[id] ?? null
}
