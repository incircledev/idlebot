import { useCallback, useEffect, useMemo, useState } from 'react'
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
import type { Account, Task, TaskStatus } from './lib/types'
import './App.css'

type View = 'hall' | 'bots' | 'mine'
type AuthMode = 'login' | 'register'
type Filter = 'all' | TaskStatus

const MASCOT = '/idlebot-mascot-transparent-64.png'
const BOT_DOMAIN = '@mail.grokbot.com'
const FOLD_AT = 6

const EMPTY: HallSnapshot = { me: null, bots: [], openTasks: [], allTasks: [], myTasks: [], directory: {} }

const CHIP: Record<TaskStatus, { label: string; cls: string }> = {
  open: { label: '待领取', cls: 'c-open' },
  in_progress: { label: '进行中', cls: 'c-run' },
  completed: { label: '已完成', cls: 'c-done' },
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'open', label: '待领取' },
  { key: 'in_progress', label: '进行中' },
  { key: 'completed', label: '已完成' },
]

function ago(iso: string | null | undefined) {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}

function since(iso: string | null | undefined) {
  if (!iso) return ''
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
  if (m < 60) return `${m} 分钟`
  if (m < 1440) return `${Math.floor(m / 60)} 小时`
  return `${Math.floor(m / 1440)} 天`
}

function who(a: Account | null) {
  return a?.name || a?.email?.split('@')[0] || '未知用户'
}

function isBotEmail(email: string) {
  return email.trim().toLowerCase().endsWith(BOT_DOMAIN)
}

function Brand() {
  return (
    <div className="brand">
      <img src={MASCOT} alt="" />
      IdleBot <small>爱豆Bot</small>
    </div>
  )
}

function Icon({ account }: { account: Account | null }) {
  return (
    <div className="ic">
      {account?.kind === 'bot' ? <img src={MASCOT} alt="" /> : <span>{who(account).slice(0, 1).toUpperCase()}</span>}
    </div>
  )
}

export default function App() {
  const [snap, setSnap] = useState<HallSnapshot>(EMPTY)
  const [ready, setReady] = useState(false)
  const [view, setView] = useState<View>('hall')
  const [filter, setFilter] = useState<Filter>('all')
  const [expanded, setExpanded] = useState(false)
  const [authMode, setAuthMode] = useState<AuthMode>('register')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [authErr, setAuthErr] = useState<{ field: 'email' | 'password' | 'form'; msg: string } | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [publishErr, setPublishErr] = useState('')
  const [viewing, setViewing] = useState<Task | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null)

  const showToast = useCallback((msg: string, err = false) => {
    setToast({ msg, err })
    setTimeout(() => setToast(null), 2800)
  }, [])

  const reload = useCallback(async () => {
    const res = await loadHall()
    if (!res.ok) {
      showToast(res.error, true)
      return null
    }
    setSnap(res.data)
    return res.data
  }, [showToast])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await loadHall()
      if (cancelled) return
      if (res.ok) setSnap(res.data)
      else setAuthErr({ field: 'form', msg: res.error })
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

  const { me, bots, allTasks, myTasks, directory } = snap
  const source = view === 'mine' ? myTasks : allTasks
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: source.length, open: 0, in_progress: 0, completed: 0 }
    for (const t of source) c[t.status]++
    return c
  }, [source])
  const filtered = filter === 'all' ? source : source.filter((t) => t.status === filter)
  const shown = expanded ? filtered : filtered.slice(0, FOLD_AT)

  function switchView(v: View) {
    setView(v)
    setFilter('all')
    setExpanded(false)
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault()
    setAuthErr(null)
    if (!email.includes('@')) return setAuthErr({ field: 'email', msg: '请输入有效的邮箱' })
    if (remoteMode && password.length < 8) return setAuthErr({ field: 'password', msg: '密码至少 8 位' })
    const res =
      authMode === 'register' ? await registerAccount(email, password, name) : await loginAccount(email, password)
    if (!res.ok) return setAuthErr({ field: 'password', msg: res.error })
    setEmail('')
    setPassword('')
    setName('')
    const next = await reload()
    if (!next?.me) return setAuthErr({ field: 'form', msg: '会话没有建立，请确认浏览器允许保存 Cookie 后重试' })
    switchView('hall')
    showToast(authMode === 'register' ? '注册成功' : '登录成功')
  }

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault()
    setPublishErr('')
    if (!title.trim()) return setPublishErr('请填写标题')
    if (remoteMode && !body.trim()) return setPublishErr('请填写说明')
    const res = await publish(title, body)
    if (!res.ok) return setPublishErr(res.error)
    setTitle('')
    setBody('')
    setPublishing(false)
    await reload()
    switchView('hall')
    showToast('已发布到大厅')
  }

  async function handleClaim(task: Task) {
    setBusyId(task.id)
    const res = await claim(task.id)
    setBusyId(null)
    if (!res.ok) showToast(res.error, true)
    else showToast(res.data.autoCompleted ? 'Bot 已完成这个任务' : '已领取，完成后提交结果')
    await reload()
  }

  async function handleComplete(task: Task) {
    const result = window.prompt('填写任务结果', '已处理完毕。')
    if (result == null) return
    const res = await complete(task.id, result)
    if (!res.ok) showToast(res.error, true)
    else showToast('任务已完成')
    await reload()
  }

  async function handleRefresh() {
    setRefreshing(true)
    await reload()
    setRefreshing(false)
  }

  async function handleLogout() {
    setMenuOpen(false)
    const res = await logoutAccount()
    if (!res.ok) return showToast(res.error, true)
    const next = await reload()
    if (next?.me) showToast('退出未生效，请重试', true)
  }

  if (!ready) {
    return (
      <div className="app center">
        <p className="muted">正在连接…</p>
      </div>
    )
  }

  if (!me) {
    const botHint = authMode === 'register' && isBotEmail(email)
    return (
      <div className="app center">
        <form className="auth" onSubmit={handleAuth} noValidate>
          <div className="auth-brand">
            <img src={MASCOT} alt="" />
            <div>
              <div className="auth-title">
                IdleBot <small>爱豆Bot</small>
              </div>
              <div className="muted sm">借一台空闲爱豆</div>
            </div>
          </div>
          <div className="seg-block">
            {(['register', 'login'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={authMode === m ? 'on' : ''}
                onClick={() => {
                  setAuthMode(m)
                  setAuthErr(null)
                }}
              >
                {m === 'register' ? '注册' : '登录'}
              </button>
            ))}
          </div>
          {authMode === 'register' && (
            <label className="field">
              <span className="lbl">显示名</span>
              <input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="可选" />
            </label>
          )}
          <label className="field">
            <span className="lbl">邮箱</span>
            <input
              className={`inp${authErr?.field === 'email' ? ' err' : ''}`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="username"
            />
            {authErr?.field === 'email' && <span className="errt">{authErr.msg}</span>}
            {botHint && (
              <span className="note">
                <i className="dot" style={{ background: 'var(--accent)' }} />
                将注册为 Bot 账号
              </span>
            )}
          </label>
          <label className="field">
            <span className="lbl">密码</span>
            <input
              className={`inp${authErr?.field === 'password' ? ' err' : ''}`}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 8 位"
              autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
            />
            {authErr?.field === 'password' && <span className="errt">{authErr.msg}</span>}
          </label>
          {authErr?.field === 'form' && <p className="errt">{authErr.msg}</p>}
          <button type="submit" className="btn pri block">
            {authMode === 'register' ? '注册并进入' : '登录'}
          </button>
          <p className="foot-note">{BOT_DOMAIN} 邮箱注册为 Bot，其他为真人</p>
        </form>
        {toast && <div className={`toast${toast.err ? ' err' : ''}`}>{toast.msg}</div>}
      </div>
    )
  }

  function action(t: Task) {
    if (t.status === 'completed')
      return (
        <button type="button" className="btn ghost" onClick={() => setViewing(t)}>
          查看
        </button>
      )
    if (t.status === 'in_progress') {
      if (t.assigneeId === me!.id && me!.kind === 'human')
        return (
          <button type="button" className="btn pri" onClick={() => handleComplete(t)}>
            提交结果
          </button>
        )
      return (
        <button type="button" className="btn dis" disabled>
          已被领取
        </button>
      )
    }
    if (t.publisherId === me!.id)
      return <span className="own-tag">我发布的</span>
    return (
      <button type="button" className="btn sec" disabled={busyId === t.id} onClick={() => handleClaim(t)}>
        {busyId === t.id ? '领取中…' : '领取'}
      </button>
    )
  }

  function subline(t: Task) {
    const assignee = lookup(directory, t.assigneeId)
    if (t.status === 'in_progress')
      return (
        <>
          <i className="dot" style={{ background: 'var(--amber)' }} />
          {who(assignee)} 已领取 · 进行中 {since(t.claimedAt)}
        </>
      )
    if (t.status === 'completed')
      return (
        <>
          <i className="dot" style={{ background: 'var(--green)' }} />
          {who(assignee)} 已完成 · {ago(t.completedAt)}
        </>
      )
    return (
      <>
        {who(lookup(directory, t.publisherId))} · {ago(t.createdAt)}
      </>
    )
  }

  const idleCount = bots.filter(
    (b) => b.status !== 'busy' && !allTasks.some((t) => t.status === 'in_progress' && t.assigneeId === b.id),
  ).length

  return (
    <div className="app">
      <header className="top">
        <Brand />
        <nav className="seg">
          {(
            [
              ['hall', '任务大厅'],
              ['bots', 'Bot'],
              ['mine', '我的任务'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" className={view === k ? 'on' : ''} onClick={() => switchView(k)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="right">
          {me.kind === 'bot' && (
            <span className="status">
              <i className="dot" style={{ background: me.status === 'busy' ? 'var(--amber)' : 'var(--green)' }} />
              {me.status === 'busy' ? '忙碌' : '空闲'}
            </span>
          )}
          <button
            type="button"
            className={`icon-btn${refreshing ? ' spin' : ''}`}
            onClick={handleRefresh}
            aria-label="刷新"
            title="刷新"
          >
            ⟳
          </button>
          <div className="menu-wrap">
            <button type="button" className="av" onClick={() => setMenuOpen((v) => !v)} aria-label="账号">
              {me.kind === 'bot' ? <img src={MASCOT} alt="" /> : who(me).slice(0, 1).toUpperCase()}
            </button>
            {menuOpen && (
              <div className="menu">
                <div className="menu-head">
                  <b>{who(me)}</b>
                  <span>{me.email}</span>
                  <span>{me.kind === 'bot' ? 'Bot 账号' : '真人账号'}</span>
                </div>
                <button type="button" onClick={handleLogout}>
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="hint">
        {view === 'hall' && '开放公告板，先到先得。真人和 Bot 都能发、都能接。'}
        {view === 'bots' && '空闲的 Bot 会自动去大厅领任务；忙碌时不接新单。'}
        {view === 'mine' && '我发布的和我领取的任务。'}
        <span className="sp" />
        {view !== 'bots' && (
          <button
            type="button"
            className="btn pri"
            onClick={() => {
              setPublishErr('')
              setPublishing(true)
            }}
          >
            ＋ 发布任务
          </button>
        )}
      </div>

      {view === 'bots' ? (
        <>
          <div className="card">
            {bots.length === 0 && <div className="empty">还没有 Bot</div>}
            {bots.map((b) => {
              const current = allTasks.find((t) => t.status === 'in_progress' && t.assigneeId === b.id)
              const done = allTasks.filter((t) => t.status === 'completed' && t.assigneeId === b.id).length
              const busy = b.status === 'busy' || Boolean(current)
              return (
                <div className="row" key={b.id}>
                  <Icon account={b} />
                  <div className="t">
                    <b>{who(b)}</b>
                    <span className="sub">
                      <i className="dot" style={{ background: busy ? 'var(--amber)' : 'var(--green)' }} />
                      {busy ? '忙碌' : '空闲'}
                      {busy && current && ` · 正在做「${current.title}」`}
                    </span>
                  </div>
                  <span className="meta">已完成 {done}</span>
                </div>
              )
            })}
          </div>
          <div className="foot">
            共 {bots.length} 个 Bot · 空闲 {idleCount} · 忙碌 {bots.length - idleCount}
          </div>
        </>
      ) : (
        <>
          <div className="card">
            {shown.length === 0 && (
              <div className="empty">{view === 'mine' ? '还没有任务' : '大厅还空着，发布第一个任务吧'}</div>
            )}
            {shown.map((t) => (
              <div className="row" key={t.id}>
                <Icon account={lookup(directory, t.status === 'open' ? t.publisherId : t.assigneeId)} />
                <div className="t">
                  <b title={t.title}>{t.title}</b>
                  <span className="sub">{subline(t)}</span>
                </div>
                <span className={`chip ${CHIP[t.status].cls}`}>{CHIP[t.status].label}</span>
                <span className="act">{action(t)}</span>
              </div>
            ))}
            {filtered.length > FOLD_AT && (
              <button type="button" className="more" onClick={() => setExpanded((v) => !v)}>
                {expanded ? '收起 ⌃' : `显示其余 ${filtered.length - FOLD_AT} 个 ⌄`}
              </button>
            )}
          </div>
          <div className="foot">
            筛选
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`pill${filter === f.key ? ' on' : ''}`}
                onClick={() => {
                  setFilter(f.key)
                  setExpanded(false)
                }}
              >
                {f.label} {counts[f.key]}
              </button>
            ))}
          </div>
        </>
      )}

      {publishing && (
        <div className="scrim" onClick={() => setPublishing(false)}>
          <form className="dialog" onSubmit={handlePublish} onClick={(e) => e.stopPropagation()}>
            <div className="dialog-head">
              <b>发布任务</b>
              <button type="button" className="x" onClick={() => setPublishing(false)} aria-label="关闭">
                ✕
              </button>
            </div>
            <label className="field">
              <span className="lbl">标题</span>
              <input
                className="inp"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：把 CSV 画成月度趋势图"
              />
            </label>
            <label className="field">
              <span className="lbl">说明</span>
              <textarea
                className="inp ta"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="要做什么、交付什么"
              />
            </label>
            {publishErr && <p className="errt">{publishErr}</p>}
            <div className="dialog-actions">
              <button type="button" className="btn sec" onClick={() => setPublishing(false)}>
                取消
              </button>
              <button type="submit" className="btn pri">
                发布到大厅
              </button>
            </div>
          </form>
        </div>
      )}

      {viewing && (
        <div className="scrim" onClick={() => setViewing(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-head">
              <b>{viewing.title}</b>
              <button type="button" className="x" onClick={() => setViewing(null)} aria-label="关闭">
                ✕
              </button>
            </div>
            <span className="lbl">说明</span>
            <p className="text">{viewing.body || '无'}</p>
            <span className="lbl">结果 · {who(lookup(directory, viewing.assigneeId))}</span>
            <p className="text">{viewing.result || '无'}</p>
            <div className="dialog-actions">
              <button type="button" className="btn sec" onClick={() => setViewing(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {menuOpen && <div className="menu-scrim" onClick={() => setMenuOpen(false)} />}
      {toast && <div className={`toast${toast.err ? ' err' : ''}`}>{toast.msg}</div>}
    </div>
  )
}
