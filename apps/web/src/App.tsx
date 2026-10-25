import { useCallback, useEffect, useState } from 'react'
import { BotAvatar } from './components/BotAvatar'
import { BrandMark } from './components/BrandMark'
import { AuthHallBackdrop } from './components/AuthHallBackdrop'
import { GuildHall } from './components/GuildHall'
import { TaskCard } from './components/TaskCard'
import {
  afterClaimRelay,
  claimTask,
  completeTask,
  ensureSeedBots,
  getAccount,
  getMe,
  listAllTasks,
  listBots,
  listMyTasks,
  listOpenTasks,
  login,
  logout,
  publishTask,
  register,
} from './lib/store'
import type { Account, Task } from './lib/types'
import './App.css'

type Panel = null | 'bots' | 'board' | 'mine' | 'publish' | 'auth'
type AuthMode = 'login' | 'register'

function useStoreTick() {
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((t) => t + 1), [])
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key?.startsWith('sgb.')) refresh()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [refresh])
  return { tick, refresh }
}

export default function App() {
  const { tick, refresh } = useStoreTick()
  const [me, setMe] = useState<Account | null>(null)
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

  useEffect(() => {
    ensureSeedBots()
    setMe(getMe())
    refresh()
  }, [refresh])

  useEffect(() => {
    setMe(getMe())
  }, [tick])

  const bots = listBots()
  const openTasks = listOpenTasks()
  const allTasks = listAllTasks()
  const myTasks = me ? listMyTasks(me.id) : []

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  function handleAuth(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const res = authMode === 'register' ? register(email, password, name) : login(email, password)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setMe(res.user)
    setPanel(null)
    setEmail('')
    setPassword('')
    setName('')
    refresh()
    showToast(authMode === 'register' ? '注册成功' : '登录成功')
  }

  function handlePublish(e: React.FormEvent) {
    e.preventDefault()
    const res = publishTask(title, body)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setTitle('')
    setBody('')
    setError('')
    setPanel('board')
    refresh()
    showToast('任务已发布到公告板')
  }

  async function handleClaim(task: Task) {
    setBusyId(task.id)
    setError('')
    const res = claimTask(task.id)
    if (!res.ok) {
      setError(res.error)
      setBusyId(null)
      refresh()
      return
    }
    const meNow = getMe()
    if (meNow?.kind === 'bot') {
      const relay = await afterClaimRelay(res.task)
      if (relay.previewReply) {
        const done = completeTask(task.id, relay.previewReply)
        if (done.ok) showToast('Bot 已通过邮件中继完成任务')
        else showToast(relay.error || '中继失败')
      } else if (relay.error) {
        showToast(relay.error)
      }
    } else {
      showToast('已接取，请提交结果完成任务')
    }
    setBusyId(null)
    setMe(getMe())
    refresh()
  }

  function handleComplete(task: Task) {
    const result = window.prompt('填写任务结果（result）', '人工完成：任务已处理完毕。')
    if (result == null) return
    const res = completeTask(task.id, result)
    if (!res.ok) {
      setError(res.error)
      return
    }
    showToast('任务已完成')
    refresh()
  }

  function handleLogout() {
    logout()
    setMe(null)
    setPanel('auth')
    refresh()
  }

  if (!me) {
    return (
      <div className="app shell-auth fantasy-app auth-screen">
        <AuthHallBackdrop />
        <div className="auth-stack">
        <header className="topbar">
          <BrandMark tagline="IdleBot · 空闲额度任务市场 · Demo" promo />
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
              placeholder="Demo 明文存 localStorage"
              autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
              required
            />
          </label>
          {error && <p className="err">{error}</p>}
          <button type="submit" className="btn primary">
            {authMode === 'register' ? '注册并进入公会' : '登录'}
          </button>
          <p className="hint">
            *@mail.grokbot.com 注册为 Bot（空闲/忙碌）；其它邮箱为真人。
            <br />
            预置 Bot：pixel / coral / starry @mail.grokbot.com，密码 demo1234
          </p>
        </form>
        </div>
      </div>
    )
  }

  return (
    <div className="app fantasy-app">
      <header className="topbar">
        <BrandMark tagline="公会大厅 · 先到先得" />
        <div className="top-actions">
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
                {bots.length === 0 && <li className="empty">暂无 Bot</li>}
              </ul>
            )}

            {panel === 'board' && (
              <div className="card-list">
                {openTasks.length === 0 && <p className="empty">公告板空空的，去发布一个吧</p>}
                {openTasks.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    publisher={getAccount(t.publisherId)}
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
                          publisher={getAccount(t.publisherId)}
                          assignee={t.assigneeId ? getAccount(t.assigneeId) : null}
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
                    publisher={getAccount(t.publisherId)}
                    assignee={t.assigneeId ? getAccount(t.assigneeId) : null}
                    action={
                      t.status === 'in_progress' && t.assigneeId === me.id && me.kind === 'human' ? (
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
                  <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder="任务详情，纯文本" />
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
