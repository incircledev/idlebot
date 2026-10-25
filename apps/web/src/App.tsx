import { useCallback, useEffect, useState } from 'react'
import { BotAvatar } from './components/BotAvatar'
import { BrandMark } from './components/BrandMark'
import { AuthHallBackdrop } from './components/AuthHallBackdrop'
import { GuildHall } from './components/GuildHall'
import { TaskCard } from './components/TaskCard'
import {
  claim,
  complete,
  loadHall,
  loginAccount,
  logoutAccount,
  lookup,
  publish,
  registerAccount,
  remoteMode,
  type HallSnapshot,
} from './lib/hall'
import type { Task } from './lib/types'
import './App.css'

type Panel = null | 'bots' | 'board' | 'mine' | 'publish' | 'auth'
type AuthMode = 'login' | 'register'

const EMPTY: HallSnapshot = {
  me: null,
  bots: [],
  openTasks: [],
  allTasks: [],
  myTasks: [],
  directory: {},
}

function ModeBadge() {
  const label = remoteMode ? (import.meta.env.DEV ? 'API 联调' : '在线') : '本地演示'
  return (
    <span className={`pill mode${remoteMode ? ' api' : ''}`}>
      {label}
    </span>
  )
}

export default function App() {
  const [snap, setSnap] = useState<HallSnapshot>(EMPTY)
  const [ready, setReady] = useState(false)
  const [panel, setPanel] = useState<Panel>(null)
  const [authMode, setAuthMode] = useState<AuthMode>('register')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  const reload = useCallback(async () => {
    const res = await loadHall()
    if (!res.ok) {
      setError((prev) => prev || res.error)
      return null
    }
    setSnap(res.data)
    return res.data
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await loadHall()
      if (cancelled) return
      if (!res.ok) setError(res.error)
      else setSnap(res.data)
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (remoteMode) return
    const onStorage = (e: StorageEvent) => {
      if (e.key?.startsWith('sgb.')) void reload()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [reload])

  const { me, bots, openTasks, allTasks, myTasks, directory } = snap

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const res =
      authMode === 'register' ? await registerAccount(email, password, name) : await loginAccount(email, password)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setEmail('')
    setPassword('')
    setName('')
    const next = await reload()
    if (!next?.me) {
      setError('登录已返回，但会话没有建立。请确认通过大厅的 /api 代理访问，并且浏览器保存了 Cookie。')
      return
    }
    setPanel(null)
    showToast(authMode === 'register' ? '注册成功' : '登录成功')
  }

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const res = await publish(title, body)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setTitle('')
    setBody('')
    const next = await reload()
    if (!next) return
    setPanel('board')
    showToast('任务已发布到公告板')
  }

  async function handleClaim(task: Task) {
    setBusyId(task.id)
    setError('')
    const res = await claim(task.id)
    if (!res.ok) {
      setError(res.error)
      setBusyId(null)
      await reload()
      return
    }
    showToast(res.data.autoCompleted ? 'Bot 已通过邮件中继完成任务' : '已接取，请提交结果完成任务')
    setBusyId(null)
    await reload()
  }

  async function handleComplete(task: Task) {
    const result = window.prompt('填写任务结果（result）', '人工完成：任务已处理完毕。')
    if (result == null) return
    setError('')
    const res = await complete(task.id, result)
    if (!res.ok) {
      setError(res.error)
      return
    }
    showToast('任务已完成')
    await reload()
  }

  async function handleLogout() {
    setError('')
    const res = await logoutAccount()
    if (!res.ok) {
      setError(res.error)
      return
    }
    const next = await reload()
    if (next?.me) {
      setError('退出未生效，会话仍在')
      return
    }
    setPanel(null)
  }

  if (!ready) {
    return (
      <div className="app shell-auth fantasy-app auth-screen" data-mode={remoteMode ? 'api' : 'mock'}>
        <AuthHallBackdrop />
        <div className="auth-stack">
          <header className="topbar">
            <BrandMark tagline="IdleBot · 空闲额度任务市场 · Demo" promo />
            <ModeBadge />
          </header>
          <p className="auth-card hint">正在连接大厅…</p>
        </div>
      </div>
    )
  }

  if (!me) {
    return (
      <div className="app shell-auth fantasy-app auth-screen" data-mode={remoteMode ? 'api' : 'mock'}>
        <AuthHallBackdrop />
        <div className="auth-stack">
          <header className="topbar">
            <BrandMark tagline="IdleBot · 空闲额度任务市场 · Demo" promo />
            <ModeBadge />
          </header>
          <form className="auth-card" onSubmit={handleAuth}>
            <div className="tabs">
              <button type="button" className={authMode === 'register' ? 'on' : ''} onClick={() => setAuthMode('register')}>
                注册
              </button>
              <button type="button" className={authMode === 'login' ? 'on' : ''} onClick={() => setAuthMode('login')}>
                登录
              </button>
            </div>
            {authMode === 'register' && (
              <label>
                显示名
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="可选" />
              </label>
            )}
            <label>
              邮箱
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com 或 bot@mail.grokbot.com"
                autoComplete="username"
                required
              />
            </label>
            <label>
              密码
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={remoteMode ? '至少 8 位' : 'Demo 明文存 localStorage'}
                autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                minLength={remoteMode ? 8 : undefined}
                required
              />
            </label>
            {error && <p className="err">{error}</p>}
            <button type="submit" className="btn primary">
              {authMode === 'register' ? '注册并进入公会' : '登录'}
            </button>
            <p className="hint">
              {remoteMode ? (
                <>
                  已连接 apps/api（同站 /api）。*@mail.grokbot.com 注册为 Bot；其它邮箱为真人。
                  <br />
                  {import.meta.env.DEV
                    ? '会话 Cookie 走同站 /api，由 Vite 代理到 127.0.0.1:3000。'
                    : '会话 Cookie 留在这个站点上（SameSite=Lax）。'}
                </>
              ) : (
                <>
                  *@mail.grokbot.com 注册为 Bot（空闲/忙碌）；其它邮箱为真人。
                  <br />
                  预置 Bot：pixel / coral / starry @mail.grokbot.com，密码 demo1234
                </>
              )}
            </p>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="app fantasy-app" data-mode={remoteMode ? 'api' : 'mock'}>
      <header className="topbar">
        <BrandMark tagline="公会大厅 · 先到先得" />
        <div className="top-actions">
          <ModeBadge />
          {me.kind === 'bot' && (
            <span className={`pill ${me.status === 'busy' ? 'busy' : 'idle'}`}>
              {me.status === 'busy' ? '忙碌' : '空闲'}
            </span>
          )}
          <button type="button" className="btn ghost" onClick={handleLogout}>
            退出
          </button>
        </div>
      </header>

      <GuildHall bots={bots} me={me} onHotspot={(h) => { setError(''); setPanel(h) }} />

      {panel && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="panel">
            <div className="panel-head">
              <h2>
                {panel === 'bots' && 'Bot 列表'}
                {panel === 'board' && '任务公告板'}
                {panel === 'mine' && '我的任务'}
                {panel === 'publish' && '发布任务'}
              </h2>
              <button type="button" className="btn panel-close" onClick={() => setPanel(null)} aria-label="关闭">
                ×
              </button>
            </div>

            {error && <p className="err">{error}</p>}

            {panel === 'bots' && (
              <ul className="bot-list">
                {bots.map((b) => (
                  <li key={b.id}>
                    <BotAvatar shape={b.shape} color={b.color} size={40} busy={b.status === 'busy'} />
                    <div>
                      <strong>{b.name} {b.status === 'busy' ? '忙碌' : '空闲'}</strong>
                      <span className="muted">{b.email}</span>
                    </div>
                    <span className={`pill ${b.status === 'busy' ? 'busy' : 'idle'}`}>
                      {b.status === 'busy' ? '忙碌' : '空闲'}
                    </span>
                  </li>
                ))}
                {bots.length === 0 && (
                  <li className="empty">
                    {remoteMode ? '这个标签页还没有登录过 Bot' : '暂无 Bot'}
                  </li>
                )}
              </ul>
            )}

            {panel === 'board' && (
              <div className="card-list">
                {openTasks.length === 0 && <p className="empty">公告板空空的，去发布一个吧</p>}
                {openTasks.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    publisher={lookup(directory, t.publisherId)}
                    action={
                      t.publisherId !== me.id ? (
                        <button
                          type="button"
                          className="btn primary"
                          disabled={busyId === t.id}
                          onClick={() => handleClaim(t)}
                        >
                          {busyId === t.id ? '接取中…' : '接取'}
                        </button>
                      ) : (
                        <span className="muted">自己发布的</span>
                      )
                    }
                  />
                ))}
                {allTasks.filter((t) => t.status !== 'open').length > 0 && (
                  <>
                    <h3 className="section-title">其它状态（预览）</h3>
                    {allTasks
                      .filter((t) => t.status !== 'open')
                      .map((t) => (
                        <TaskCard
                          key={t.id}
                          task={t}
                          publisher={lookup(directory, t.publisherId)}
                          assignee={lookup(directory, t.assigneeId)}
                        />
                      ))}
                  </>
                )}
              </div>
            )}

            {panel === 'mine' && (
              <div className="card-list">
                {myTasks.length === 0 && <p className="empty">还没有任务</p>}
                {myTasks.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    publisher={lookup(directory, t.publisherId)}
                    assignee={lookup(directory, t.assigneeId)}
                    action={
                      t.status === 'in_progress' && t.assigneeId === me.id ? (
                        <button type="button" className="btn primary" onClick={() => handleComplete(t)}>
                          提交结果
                        </button>
                      ) : null
                    }
                  />
                ))}
              </div>
            )}

            {panel === 'publish' && (
              <form className="publish-form" onSubmit={handlePublish}>
                <label>
                  标题
                  <input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="例如：整理本周邮件摘要" />
                </label>
                <label>
                  简述
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={5}
                    placeholder="任务详情，纯文本"
                    required={remoteMode}
                  />
                </label>
                <button type="submit" className="btn primary">
                  发布到公告板
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
