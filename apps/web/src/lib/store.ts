import type { Account, BotShape, Task, TaskStatus } from './types'
import { BOT_COLORS, BOT_SHAPES } from './types'
import { buildRelayBody, buildRelaySubject, sendViaRelay } from './mailRelay'

const USERS_KEY = 'sgb.users.v1'
const TASKS_KEY = 'sgb.tasks.v1'
const SESSION_KEY = 'sgb.session.v1' // sessionStorage — per tab

function uid(): string {
  return crypto.randomUUID()
}

function readUsers(): Account[] {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) || '[]') as Account[]
  } catch {
    return []
  }
}

function writeUsers(users: Account[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users))
}

function readTasks(): Task[] {
  try {
    return JSON.parse(localStorage.getItem(TASKS_KEY) || '[]') as Task[]
  } catch {
    return []
  }
}

function writeTasks(tasks: Task[]) {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks))
}

export function getSessionUserId(): string | null {
  return sessionStorage.getItem(SESSION_KEY)
}

export function setSessionUserId(id: string | null) {
  if (id) sessionStorage.setItem(SESSION_KEY, id)
  else sessionStorage.removeItem(SESSION_KEY)
}

export function getMe(): Account | null {
  const id = getSessionUserId()
  if (!id) return null
  return readUsers().find((u) => u.id === id) ?? null
}

function isBotEmail(email: string): boolean {
  return email.toLowerCase().endsWith('@mail.grokbot.com')
}

export type AuthResult = { ok: true; user: Account } | { ok: false; error: string }

export function register(email: string, password: string, name?: string): AuthResult {
  const trimmed = email.trim().toLowerCase()
  if (!trimmed || !password) return { ok: false, error: '请填写邮箱和密码' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return { ok: false, error: '邮箱格式不正确' }

  const kind = isBotEmail(trimmed) ? 'bot' : 'human'
  if (kind === 'bot' && !isBotEmail(trimmed)) {
    return { ok: false, error: 'Bot 邮箱必须是 *@mail.grokbot.com' }
  }

  const users = readUsers()
  if (users.some((u) => u.email === trimmed)) return { ok: false, error: '该邮箱已注册' }

  const idx = users.filter((u) => u.kind === 'bot').length
  const user: Account = {
    id: uid(),
    email: trimmed,
    password,
    kind,
    name: name?.trim() || (kind === 'bot' ? trimmed.split('@')[0] : trimmed.split('@')[0]),
    displayName: name?.trim() || undefined,
    status: kind === 'bot' ? 'idle' : null,
    shape: kind === 'bot' ? BOT_SHAPES[idx % BOT_SHAPES.length] : undefined,
    color: kind === 'bot' ? BOT_COLORS[idx % BOT_COLORS.length] : undefined,
    createdAt: new Date().toISOString(),
  }
  users.push(user)
  writeUsers(users)
  setSessionUserId(user.id)
  return { ok: true, user }
}

export function login(email: string, password: string): AuthResult {
  const trimmed = email.trim().toLowerCase()
  const user = readUsers().find((u) => u.email === trimmed)
  if (!user || user.password !== password) return { ok: false, error: '邮箱或密码错误' }
  setSessionUserId(user.id)
  return { ok: true, user }
}

export function logout() {
  setSessionUserId(null)
}

export function listBots(): Account[] {
  return readUsers().filter((u) => u.kind === 'bot')
}

export function listOpenTasks(): Task[] {
  return readTasks()
    .filter((t) => t.status === 'open')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function listAllTasks(): Task[] {
  return readTasks().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function listMyTasks(userId: string): Task[] {
  return readTasks()
    .filter((t) => t.publisherId === userId || t.assigneeId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getAccount(id: string): Account | null {
  return readUsers().find((u) => u.id === id) ?? null
}

export function publishTask(title: string, body: string): { ok: true; task: Task } | { ok: false; error: string } {
  const me = getMe()
  if (!me) return { ok: false, error: '未登录' }
  if (!title.trim()) return { ok: false, error: '请填写标题' }
  const task: Task = {
    id: uid(),
    title: title.trim(),
    body: body.trim(),
    publisherId: me.id,
    assigneeId: null,
    status: 'open',
    result: null,
    createdAt: new Date().toISOString(),
    claimedAt: null,
    completedAt: null,
  }
  const tasks = readTasks()
  tasks.push(task)
  writeTasks(tasks)
  return { ok: true, task }
}

/** Atomic first-come claim via localStorage read-modify-write. */
export function claimTask(taskId: string): { ok: true; task: Task } | { ok: false; error: string } {
  const me = getMe()
  if (!me) return { ok: false, error: '未登录' }

  const tasks = readTasks()
  const idx = tasks.findIndex((t) => t.id === taskId)
  if (idx < 0) return { ok: false, error: '任务不存在' }
  const task = tasks[idx]
  if (task.publisherId === me.id) return { ok: false, error: '不能接取自己发布的任务' }
  if (task.status !== 'open' || task.assigneeId) return { ok: false, error: '任务已被接取' }

  task.status = 'in_progress'
  task.assigneeId = me.id
  task.claimedAt = new Date().toISOString()
  tasks[idx] = task
  writeTasks(tasks)

  if (me.kind === 'bot') {
    const users = readUsers()
    const uIdx = users.findIndex((u) => u.id === me.id)
    if (uIdx >= 0) {
      users[uIdx] = { ...users[uIdx], status: 'busy' }
      writeUsers(users)
    }
  }

  return { ok: true, task }
}

export async function afterClaimRelay(task: Task): Promise<{ relayed: boolean; previewReply?: string; error?: string }> {
  const me = getMe()
  if (!me || me.kind !== 'bot') return { relayed: false }
  const subject = buildRelaySubject(task.id, task.title)
  const body = buildRelayBody(task.id, task.body)
  const res = await sendViaRelay({
    taskId: task.id,
    fromUserId: me.id,
    toAddress: me.email,
    subject,
    body,
  })
  if (!res.ok) return { relayed: true, error: res.error }
  return { relayed: true, previewReply: res.previewReply }
}

/** POST /tasks/:id/complete {result} 或 /relay/mock-complete 等价 */
export function completeTask(
  taskId: string,
  result: string,
): { ok: true; task: Task } | { ok: false; error: string } {
  const me = getMe()
  if (!me) return { ok: false, error: '未登录' }

  const tasks = readTasks()
  const idx = tasks.findIndex((t) => t.id === taskId)
  if (idx < 0) return { ok: false, error: '任务不存在' }
  const task = tasks[idx]
  if (task.status !== 'in_progress') return { ok: false, error: '只能完成进行中的任务' }
  if (task.assigneeId !== me.id && task.publisherId !== me.id) {
    return { ok: false, error: '无权完成此任务' }
  }

  task.status = 'completed'
  task.result = result
  task.completedAt = new Date().toISOString()
  tasks[idx] = task
  writeTasks(tasks)

  if (task.assigneeId) {
    const users = readUsers()
    const uIdx = users.findIndex((u) => u.id === task.assigneeId)
    if (uIdx >= 0 && users[uIdx].kind === 'bot') {
      users[uIdx] = { ...users[uIdx], status: 'idle' }
      writeUsers(users)
    }
  }

  return { ok: true, task }
}

export function ensureSeedBots() {
  const users = readUsers()
  if (users.some((u) => u.kind === 'bot')) return
  const seeds: Array<{ email: string; name: string; shape: BotShape; color: string }> = [
    { email: 'pixel@mail.grokbot.com', name: 'Pixel', shape: 'circle', color: BOT_COLORS[0] },
    { email: 'coral@mail.grokbot.com', name: 'Coral', shape: 'blob', color: BOT_COLORS[2] },
    { email: 'starry@mail.grokbot.com', name: 'Starry', shape: 'star', color: BOT_COLORS[5] },
  ]
  for (const s of seeds) {
    users.push({
      id: uid(),
      email: s.email,
      password: 'demo1234',
      kind: 'bot',
      name: s.name,
      displayName: s.name,
      status: 'idle',
      shape: s.shape,
      color: s.color,
      createdAt: new Date().toISOString(),
    })
  }
  writeUsers(users)
}

export type { TaskStatus }
