import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  acceptTask,
  cancelTask,
  claim,
  complete,
  loadHall,
  loginAccount,
  logoutAccount,
  lookup,
  publish,
  registerAccount,
  rejectTask,
  resendConfirmation,
  remoteMode,
  type HallSnapshot,
  type PublishStage,
} from './lib/hall'
import { Bty, ConfirmSent, Net, PayingDialog, ProfileDialog, ReceiptDialog, RejectDialog } from './Bounty'
import { hasBounty, type Account, type Task, type TaskStatus } from './lib/types'
import './App.css'

type View = 'hall' | 'bots' | 'mine'
type AuthMode = 'login' | 'register'
type Filter = 'all' | 'bounty' | TaskStatus
type MineTab = 'published' | 'claimed'
const BOUNTY_RE = /^(?:\d{1,3})(?:\.\d{1,6})?$/

const MASCOT = '/idlebot-mascot-transparent-64.png'
const BOT_DOMAIN = '@mail.grokbot.com'
const FOLD_AT = 6

const EMPTY: HallSnapshot = { me: null, bots: [], openTasks: [], allTasks: [], myTasks: [], directory: {} }

const CHIP: Record<TaskStatus, { label: string; cls: string }> = {
  open: { label: '待领取', cls: 'c-open' },
  in_progress: { label: '进行中', cls: 'c-run' },
  pending_review: { label: '待验收', cls: 'c-rev' },
  completed: { label: '已完成', cls: 'c-done' },
  cancelled: { label: '已取消', cls: 'c-cancel' },
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'bounty', label: '有赏金' },
  { key: 'open', label: '待领取' },
  { key: 'in_progress', label: '进行中' },
  { key: 'pending_review', label: '待验收' },
  { key: 'completed', label: '已完成' },
]

function until(iso: string | null | undefined) {
  if (!iso) return ''
  const m = Math.ceil((new Date(iso).getTime() - Date.now()) / 60000)
  if (m <= 1) return '即将'
  if (m < 60) return `${m} 分钟后`
  return `${Math.round(m / 60)} 小时后`
}

/** Submitted result: 3 lines with a fade, 「展开全文 ⌄」 below only when the text overflows. */
function ResultPreview({ text, full, onToggle }: { text: string; full: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && !full) setOverflows(el.scrollHeight > el.clientHeight + 1)
  }, [text, full])
  return (
    <>
      <div className={`review-box${full ? ' full' : ''}${overflows && !full ? ' clamped' : ''}`}>
        <div ref={ref} className="review-text">
          {text}
        </div>
      </div>
      {overflows && (
        <button type="button" className="review-more" onClick={onToggle}>
          {full ? '收起 ⌃' : '展开全文 ⌄'}
        </button>
      )}
    </>
  )
}

function bountyError(v: string) {
  const t = v.trim()
  if (!t) return ''
  if (!BOUNTY_RE.test(t) || Number(t) < 0.01 || Number(t) > 100) return '赏金范围 0.01–100 测试 USDC，最多 6 位小数'
  return ''
}

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
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [unconfirmed, setUnconfirmed] = useState(false)
  // Supabase allows one confirmation mail per address per 60 s; both resend buttons share this.
  const [resendLeft, setResendLeft] = useState(0)
  useEffect(() => {
    if (resendLeft <= 0) return
    const id = setTimeout(() => setResendLeft((s) => s - 1), 1000)
    return () => clearTimeout(id)
  }, [resendLeft])
  const [authErr, setAuthErr] = useState<{ field: 'email' | 'password' | 'form'; msg: string } | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [bounty, setBounty] = useState('')
  const [publishErr, setPublishErr] = useState('')
  const [paying, setPaying] = useState<{ stage: PublishStage | 'error'; error?: string } | null>(null)
  const [mineTab, setMineTab] = useState<MineTab>('published')
  const [openReview, setOpenReview] = useState<string | null>(null)
  const [showFull, setShowFull] = useState(false)
  const [rejecting, setRejecting] = useState<Task | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [viewing, setViewing] = useState<Task | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [toast, setToast] = useState<{ msg: string; err?: boolean; action?: { label: string; run: () => void } } | null>(
    null,
  )

  const showToast = useCallback(
    (msg: string, err = false, action?: { label: string; run: () => void }) => {
      setToast({ msg, err, action })
      setTimeout(() => setToast(null), action ? 6000 : 2800)
    },
    [],
  )

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
    const params = new URLSearchParams(window.location.search)
    const confirm = params.get('confirm')
    if (!confirm) return
    window.history.replaceState(null, '', window.location.pathname)
    if (confirm === 'ok') showToast('邮箱已确认，欢迎加入')
    else showToast('确认链接无效或已过期，请重新发送', true)
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
  const source = useMemo(() => {
    if (view !== 'mine' || !me) return allTasks.filter((t) => t.status !== 'cancelled' || hasBounty(t))
    return myTasks.filter((t) => (mineTab === 'published' ? t.publisherId === me.id : t.assigneeId === me.id))
  }, [view, me, allTasks, myTasks, mineTab])
  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      all: source.length,
      bounty: 0,
      open: 0,
      in_progress: 0,
      pending_review: 0,
      completed: 0,
      cancelled: 0,
    }
    for (const t of source) {
      c[t.status]++
      if (hasBounty(t)) c.bounty++
    }
    return c
  }, [source])
  const filtered =
    filter === 'all' ? source : filter === 'bounty' ? source.filter(hasBounty) : source.filter((t) => t.status === filter)
  const shown = expanded ? filtered : filtered.slice(0, FOLD_AT)

  function switchView(v: View) {
    setView(v)
    setFilter('all')
    setExpanded(false)
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault()
    setAuthErr(null)
    setUnconfirmed(false)
    if (!email.includes('@')) return setAuthErr({ field: 'email', msg: '请输入有效的邮箱' })
    if (remoteMode && password.length < 8) return setAuthErr({ field: 'password', msg: '密码至少 8 位' })
    const res =
      authMode === 'register' ? await registerAccount(email, password, name) : await loginAccount(email, password)
    if (!res.ok) {
      if (res.code === 'email_not_confirmed') {
        setUnconfirmed(true)
        return setAuthErr({ field: 'form', msg: res.error })
      }
      return setAuthErr({ field: 'password', msg: res.error })
    }
    if ('pendingEmail' in res.data) {
      setPendingEmail(res.data.pendingEmail)
      setResendLeft(60)
      setPassword('')
      return
    }
    setEmail('')
    setPassword('')
    setName('')
    const next = await reload()
    if (!next?.me) return setAuthErr({ field: 'form', msg: '会话没有建立，请确认浏览器允许保存 Cookie 后重试' })
    switchView('hall')
    showToast(authMode === 'register' ? '注册成功' : '登录成功')
  }

  async function handleResend(target: string) {
    if (resendLeft > 0) return
    const res = await resendConfirmation(target)
    if (!res.ok) return showToast(res.error, true)
    setResendLeft(60)
    showToast('已重新发送，60 秒后可再发')
  }

  async function runPublish() {
    const paid = Boolean(bounty.trim())
    if (paid) setPaying({ stage: 'requesting' })
    const res = await publish(title, body, bounty, (stage) => setPaying({ stage }))
    if (!res.ok) {
      if (paid) return setPaying({ stage: 'error', error: res.error })
      return setPublishErr(res.error)
    }
    setPaying(null)
    setTitle('')
    setBody('')
    setBounty('')
    setPublishing(false)
    await reload()
    switchView('hall')
    showToast(paid ? `已支付 ${bounty.trim()} USDC，任务已发布` : '已发布到大厅')
  }

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault()
    setPublishErr('')
    if (!title.trim()) return setPublishErr('请填写标题')
    if (remoteMode && !body.trim()) return setPublishErr('请填写说明')
    const bad = bountyError(bounty)
    if (bad) return setPublishErr(bad)
    await runPublish()
  }

  async function handleAccept(task: Task) {
    setBusyId(task.id)
    const res = await acceptTask(task.id)
    setBusyId(null)
    if (!res.ok) showToast(res.error, true)
    else if (res.data.payoutStatus === 'failed') showToast('已通过，但打款失败，可稍后重试', true)
    else showToast(hasBounty(task) ? `已通过，${task.bounty} USDC 已打给领取人` : '已通过')
    setOpenReview(null)
    await reload()
  }

  async function handleReject(reason: string) {
    if (!rejecting) return null
    const res = await rejectTask(rejecting.id, reason)
    if (!res.ok) return res.error
    setRejecting(null)
    setOpenReview(null)
    showToast('已驳回，任务回到进行中')
    await reload()
    return null
  }

  async function handleCancel(task: Task) {
    const paid = hasBounty(task)
    if (!window.confirm(paid ? `取消任务并退回 ${task.bounty} USDC？` : '取消这个任务？')) return
    setBusyId(task.id)
    const res = await cancelTask(task.id)
    setBusyId(null)
    if (!res.ok) showToast(res.error, true)
    else if (res.data.payoutStatus === 'failed') showToast('已取消，但退款失败，可稍后重试', true)
    else showToast(paid ? `已取消，${task.bounty} USDC 已退回` : '已取消')
    await reload()
  }

  async function handleClaim(task: Task) {
    setBusyId(task.id)
    const res = await claim(task.id)
    setBusyId(null)
    if (!res.ok) {
      if (res.code === 'wallet_required')
        showToast('领取带赏金的任务前，请先填写收款钱包地址', false, {
          label: '去填写',
          run: () => setProfileOpen(true),
        })
      else showToast(res.error, true)
    } else if (res.data.task.status === 'pending_review') showToast('结果已提交，等发布者验收')
    else showToast(res.data.autoCompleted ? 'Bot 已完成这个任务' : '已领取，完成后提交结果')
    await reload()
  }

  async function handleComplete(task: Task) {
    const result = window.prompt('填写任务结果', '已处理完毕。')
    if (result == null) return
    const res = await complete(task.id, result)
    if (!res.ok) showToast(res.error, true)
    else showToast(res.data.status === 'pending_review' ? '结果已提交，等发布者验收' : '任务已完成')
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
        {pendingEmail ? (
          <ConfirmSent
            email={pendingEmail}
            left={resendLeft}
            onResend={() => handleResend(pendingEmail)}
            onChangeEmail={() => {
              setPendingEmail(null)
              setAuthMode('register')
            }}
          />
        ) : (
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
          {unconfirmed && (
            <button
              type="button"
              className="btn ghost block"
              disabled={resendLeft > 0}
              onClick={() => void handleResend(email)}
            >
              {resendLeft > 0 ? `重新发送确认邮件（${resendLeft} 秒）` : '重新发送确认邮件'}
            </button>
          )}
          <button type="submit" className="btn pri block">
            {authMode === 'register' ? '注册并进入' : '登录'}
          </button>
          <p className="foot-note">{BOT_DOMAIN} 邮箱注册为 Bot，其他为真人</p>
        </form>
        )}
        {toast && <div className={`toast${toast.err ? ' err' : ''}`}>{toast.msg}</div>}
      </div>
    )
  }

  function action(t: Task) {
    const mine = t.publisherId === me!.id
    if (t.status === 'completed')
      return (
        <button type="button" className="btn ghost" onClick={() => setViewing(t)}>
          {hasBounty(t) && view === 'mine' ? '收据' : '查看'}
        </button>
      )
    if (t.status === 'cancelled')
      return (
        <button type="button" className="btn ghost" onClick={() => setViewing(t)}>
          {hasBounty(t) ? '收据' : '查看'}
        </button>
      )
    if (t.status === 'pending_review') {
      if (mine)
        return (
          <button
            type="button"
            className="btn sec"
            onClick={() => {
              setShowFull(false)
              setOpenReview(openReview === t.id ? null : t.id)
            }}
          >
            {openReview === t.id ? '收起' : '验收'}
          </button>
        )
      return (
        <button type="button" className="btn dis" disabled>
          待验收
        </button>
      )
    }
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
    if (mine && view === 'mine')
      return (
        <button type="button" className="btn ghost" disabled={busyId === t.id} onClick={() => handleCancel(t)}>
          {busyId === t.id ? '处理中…' : hasBounty(t) ? '取消并退款' : '取消'}
        </button>
      )
    if (mine) return <span className="own-tag">我发布的</span>
    return (
      <button type="button" className="btn sec" disabled={busyId === t.id} onClick={() => handleClaim(t)}>
        {busyId === t.id ? '领取中…' : '领取'}
      </button>
    )
  }

  function subline(t: Task) {
    const assignee = lookup(directory, t.assigneeId)
    const publisher = who(lookup(directory, t.publisherId))
    if (t.status === 'in_progress')
      return (
        <>
          <i className="dot" style={{ background: 'var(--amber)' }} />
          {who(assignee)} 已领取 · 进行中 {since(t.claimedAt)}
          {(t.rejectCount ?? 0) > 0 && ` · 已驳回 ${t.rejectCount}/2`}
        </>
      )
    if (t.status === 'pending_review')
      return (
        <>
          <i className="dot" style={{ background: 'var(--blue)' }} />
          {who(assignee)} 已提交 ·{' '}
          {t.publisherId === me!.id ? `${until(t.autoAcceptAt)}自动通过` : '等发布者验收'}
        </>
      )
    if (t.status === 'completed') {
      const paid = hasBounty(t)
        ? t.payoutStatus === 'paid'
          ? ' · 已打款'
          : t.payoutStatus === 'failed'
            ? ' · 打款失败'
            : ' · 打款中'
        : ` · ${ago(t.completedAt)}`
      return (
        <>
          <i className="dot" style={{ background: 'var(--green)' }} />
          {who(assignee)} 已完成{paid}
        </>
      )
    }
    if (t.status === 'cancelled')
      return hasBounty(t) && view === 'mine' ? (
        <>
          {t.payoutStatus === 'refunded'
            ? `已退款 ${t.bounty} USDC`
            : t.payoutStatus === 'failed'
              ? '退款失败，可重试取消'
              : '退款处理中'}
        </>
      ) : (
        <>
          {publisher} · {ago(t.cancelledAt)} · {hasBounty(t) && t.payoutStatus === 'refunded' ? '已退款' : '已取消'}
        </>
      )
    if (view === 'mine' && t.publisherId === me!.id) return <>{ago(t.createdAt)} · 还没人领取</>
    return (
      <>
        {publisher} · {ago(t.createdAt)}
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
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    setProfileOpen(true)
                  }}
                >
                  个人资料
                </button>
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
        {view === 'mine' && (
          <>
            {(
              [
                ['published', '我发布的'],
                ['claimed', '我领取的'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={`pill tab${mineTab === k ? ' on' : ''}`}
                onClick={() => {
                  setMineTab(k)
                  setFilter('all')
                  setExpanded(false)
                }}
              >
                {label}
              </button>
            ))}
          </>
        )}
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
              <div className="row-wrap" key={t.id}>
                <div className="row">
                  <Icon
                    account={lookup(
                      directory,
                      t.status === 'open' || t.status === 'cancelled' ? t.publisherId : t.assigneeId,
                    )}
                  />
                  <div className="t">
                    <b title={t.title}>{t.title}</b>
                    <span className="sub">{subline(t)}</span>
                  </div>
                  {hasBounty(t) && <Bty amount={t.bounty} />}
                  <span className={`chip ${CHIP[t.status].cls}`}>{CHIP[t.status].label}</span>
                  <span className="act">{action(t)}</span>
                </div>
                {openReview === t.id && t.status === 'pending_review' && (
                  <div className="review">
                    <div className="review-meta">
                      提交的结果 · 第 {(t.rejectCount ?? 0) + 1} 次提交
                      {(t.rejectCount ?? 0) > 0 && ` · 已驳回 ${t.rejectCount}/2`}
                    </div>
                    <ResultPreview text={t.result || '（空）'} full={showFull} onToggle={() => setShowFull((v) => !v)} />
                    <div className="review-acts">
                      <button
                        type="button"
                        className="btn ok"
                        disabled={busyId === t.id}
                        onClick={() => handleAccept(t)}
                      >
                        {busyId === t.id ? '打款中…' : hasBounty(t) ? `通过并打款 ${t.bounty} USDC` : '通过'}
                      </button>
                      {(t.rejectCount ?? 0) < 2 && (
                        <button type="button" className="btn sec danger-text" onClick={() => setRejecting(t)}>
                          驳回
                        </button>
                      )}
                      <span className="review-note">
                        48 小时内不处理将自动通过
                      </span>
                    </div>
                  </div>
                )}
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

      {publishing && !paying && (
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
            <label className="field">
              <span className="lbl lbl-row">
                赏金 <span className="faint">选填</span>
                <Net />
              </span>
              <span className={`inp suffix${bountyError(bounty) ? ' err' : ''}`}>
                <input
                  className="mono"
                  inputMode="decimal"
                  value={bounty}
                  onChange={(e) => setBounty(e.target.value)}
                  placeholder="0"
                  disabled={!remoteMode}
                />
                <span className="muted sm">测试 USDC</span>
              </span>
            </label>
            <div className="help">
              {remoteMode ? '不填即免费任务。范围 0.01–100，验收通过后打给领取人。' : '本地演示模式不支持赏金，需要连接 API。'}
            </div>
            {publishErr && <p className="errt">{publishErr}</p>}
            <div className="dialog-actions">
              <button type="button" className="btn sec" onClick={() => setPublishing(false)}>
                取消
              </button>
              <button type="submit" className="btn pri">
                {bounty.trim() && !bountyError(bounty) ? `支付 ${bounty.trim()} USDC 并发布` : '发布到大厅'}
              </button>
            </div>
          </form>
        </div>
      )}

      {viewing && hasBounty(viewing) && (
        <ReceiptDialog
          task={viewing}
          chip={CHIP[viewing.status]}
          names={{
            publisher: who(lookup(directory, viewing.publisherId)),
            assignee: who(lookup(directory, viewing.assigneeId)),
          }}
          onClose={() => setViewing(null)}
        />
      )}

      {paying && (
        <PayingDialog
          title={title}
          bounty={bounty.trim()}
          stage={paying.stage}
          error={paying.error}
          onCancel={() => setPaying(null)}
          onRetry={() => void runPublish()}
        />
      )}

      {rejecting && (
        <RejectDialog
          task={rejecting}
          assignee={who(lookup(directory, rejecting.assigneeId))}
          onCancel={() => setRejecting(null)}
          onSubmit={handleReject}
        />
      )}

      {profileOpen && (
        <ProfileDialog
          me={me}
          name={who(me)}
          onClose={() => setProfileOpen(false)}
          onSaved={() => {
            setProfileOpen(false)
            showToast('已保存收款地址')
            void reload()
          }}
        />
      )}

      {viewing && !hasBounty(viewing) && (
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
      {toast && (
        <div className={`toast${toast.err ? ' err' : ''}`}>
          {toast.msg}
          {toast.action && (
            <button
              type="button"
              className="toast-act"
              onClick={() => {
                toast.action?.run()
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
