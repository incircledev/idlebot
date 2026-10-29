import { useEffect, useState } from 'react'
import type { PublicLedgerEntry } from '@idlebot/contract'
import { loadReceipt, saveWallet, type PublishStage } from './lib/hall'
import type { Account, Task } from './lib/types'

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const BASESCAN = 'https://sepolia.basescan.org/tx/'

export const Net = ({ children = '测试网 · Base Sepolia' }: { children?: string }) => <span className="net">{children}</span>

export const Bty = ({ amount }: { amount: string }) => <span className="bty">{amount} USDC</span>

function shortHash(h: string) {
  return `${h.slice(0, 6)}…${h.slice(-4)}`
}

function Head({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="dialog-head">
      <b>{title}</b>
      <button type="button" className="x" onClick={onClose} aria-label="关闭">
        ✕
      </button>
    </div>
  )
}

/** b1b — waiting for the browser wallet to sign the x402 authorization. */
export function PayingDialog(props: {
  title: string
  bounty: string
  stage: PublishStage | 'error'
  error?: string
  onCancel: () => void
  onRetry: () => void
}) {
  const { title, bounty, stage, error, onCancel, onRetry } = props
  const label =
    stage === 'settling' ? '链上确认中，约需 10 秒…' : stage === 'requesting' ? '正在创建付款请求…' : '等待钱包签名…'
  // After signing, the facilitator settles on chain (retrying when it is busy): reassure after 20 s.
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (stage !== 'settling') return
    const id = setTimeout(() => setSlow(true), 20_000)
    return () => {
      clearTimeout(id)
      setSlow(false)
    }
  }, [stage])
  return (
    <div className="scrim">
      <div className="dialog" role="dialog" aria-label="支付赏金">
        <Head title="支付赏金" onClose={onCancel} />
        <div className="info">
          <div>
            <span>任务</span>
            <b>{title}</b>
          </div>
          <div>
            <span>赏金</span>
            <Bty amount={bounty} />
          </div>
          <div>
            <span>手续费</span>
            <b>0（测试网）</b>
          </div>
          <div>
            <span>网络</span>
            <Net>Base Sepolia</Net>
          </div>
        </div>
        {stage === 'error' ? (
          <p className="errt pay-err">{error}</p>
        ) : (
          <>
            <div className="waiting">
              <span className="spinner" />
              {label}
            </div>
            {stage === 'settling' && slow && <div className="waiting-slow">网络较慢，请勿关闭页面</div>}
          </>
        )}
        <div className="help">只需签一次名，不需要测试 ETH。赏金先由平台代管，验收通过后打给领取人。</div>
        <div className="dialog-actions">
          <button type="button" className="btn sec" onClick={onCancel}>
            取消
          </button>
          {stage === 'error' ? (
            <button type="button" className="btn pri" onClick={onRetry}>
              重试
            </button>
          ) : (
            <button type="button" className="btn pri" disabled>
              支付中…
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** b4 — reject needs a reason; at most two rejections. */
export function RejectDialog(props: {
  task: Task
  assignee: string
  onCancel: () => void
  onSubmit: (reason: string) => Promise<string | null>
}) {
  const { task, assignee, onCancel, onSubmit } = props
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const nth = (task.rejectCount ?? 0) + 1
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!reason.trim()) return setErr('请写驳回原因')
    setBusy(true)
    const failed = await onSubmit(reason.trim())
    setBusy(false)
    if (failed) setErr(failed)
  }
  return (
    <div className="scrim" onClick={onCancel}>
      <form className="dialog" onSubmit={submit} onClick={(e) => e.stopPropagation()} noValidate>
        <Head title="驳回结果" onClose={onCancel} />
        <div className="dialog-sub">
          {task.title} · {assignee}
        </div>
        <label className="field">
          <span className="lbl">
            驳回原因 <span style={{ color: 'var(--red)' }}>*</span>
          </span>
          <textarea
            className={`inp ta${err ? ' err' : ''}`}
            autoFocus
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              setErr('')
            }}
            placeholder="告诉对方哪里不对，怎么改"
          />
        </label>
        {err && <span className="errt">{err}</span>}
        <div className="help with-dot">
          <i className="dot" style={{ background: 'var(--amber)' }} />
          {nth >= 2
            ? `这是第 ${nth} 次驳回，之后只能通过。任务会回到「进行中」。`
            : `这是第 ${nth} 次驳回，最多 2 次。任务会回到「进行中」。`}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn sec" onClick={onCancel}>
            取消
          </button>
          <button type="submit" className="btn dan" disabled={busy}>
            {busy ? '驳回中…' : '确认驳回'}
          </button>
        </div>
      </form>
    </div>
  )
}

const KIND_LABEL: Record<PublicLedgerEntry['kind'], string> = { payment: '收款', payout: '打款', refund: '退款' }

/** b5 — task detail with the bounty receipt (every ledger movement, linked to basescan). */
export function ReceiptDialog(props: {
  task: Task
  chip: { label: string; cls: string }
  names: { publisher: string; assignee: string }
  onClose: () => void
}) {
  const { task, chip, names, onClose } = props
  const [rows, setRows] = useState<PublicLedgerEntry[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let live = true
    void loadReceipt(task.id).then((res) => {
      if (!live) return
      if (res.ok) setRows(res.data)
      else setErr(res.error)
    })
    return () => {
      live = false
    }
  }, [task.id])

  function route(r: PublicLedgerEntry) {
    if (r.kind === 'payment') return `${names.publisher} → 平台代管`
    if (r.kind === 'payout') return `平台 → ${names.assignee}`
    return `平台 → ${names.publisher}`
  }
  const by =
    task.status === 'completed'
      ? `${names.assignee} 完成 · ${names.publisher} 发布`
      : task.status === 'cancelled'
        ? `${names.publisher} 发布 · 已取消`
        : `${names.publisher} 发布`

  return (
    <div className="scrim" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <Head title={task.title} onClose={onClose} />
        <div className="dialog-sub row-inline">
          <span className={`chip ${chip.cls}`}>{chip.label}</span>
          <span className="muted sm">{by}</span>
        </div>
        {task.result && (
          <>
            <span className="lbl">结果</span>
            <p className="text">{task.result}</p>
          </>
        )}
        <div className="rc-title">
          赏金收据 <Net />
        </div>
        <div className="rc">
          {rows === null && !err && <div className="rc-row muted">读取中…</div>}
          {err && <div className="rc-row errt">{err}</div>}
          {rows?.length === 0 && <div className="rc-row muted">还没有记录</div>}
          {rows?.map((r) => (
            <div className="rc-row" key={r.kind}>
              <span className="rc-kind">{KIND_LABEL[r.kind]}</span>
              <Bty amount={r.amount} />
              <span className="muted sm">{route(r)}</span>
              <span className="rc-tx">
                {r.status === 'pending' && <span className="muted sm">处理中</span>}
                {r.status === 'failed' && <span className="errt sm">失败，可重试</span>}
                {r.status === 'confirmed' && r.txHash && r.mock && (
                  <span className="mono muted" title="模拟模式：没有上链">
                    {shortHash(r.txHash)} <span className="mock-tag">模拟</span>
                  </span>
                )}
                {r.status === 'confirmed' && r.txHash && !r.mock && (
                  <a className="mono tx-link" href={`${BASESCAN}${r.txHash}`} target="_blank" rel="noreferrer" title="在 basescan 查看">
                    {shortHash(r.txHash)} ↗
                  </a>
                )}
              </span>
            </div>
          ))}
        </div>
        <div className="help">交易哈希可在 basescan 查看。退款记录也显示在这里，标「退款」。</div>
        <div className="dialog-actions">
          <button type="button" className="btn sec" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}

/** b6 — profile with the Base Sepolia payout address. */
export function ProfileDialog(props: {
  me: Account
  name: string
  onClose: () => void
  onSaved: (a: Account) => void
}) {
  const { me, name, onClose, onSaved } = props
  const [addr, setAddr] = useState(me.walletAddress ?? '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const v = addr.trim()
    if (v && !ADDRESS_RE.test(v)) return setErr('地址格式不对，应为 0x 开头的 42 位')
    setBusy(true)
    const res = await saveWallet(v)
    setBusy(false)
    if (!res.ok) return setErr(res.error)
    onSaved(res.data)
  }
  return (
    <div className="scrim" onClick={onClose}>
      <form className="dialog" onSubmit={submit} onClick={(e) => e.stopPropagation()} noValidate>
        <Head title="个人资料" onClose={onClose} />
        <label className="field">
          <span className="lbl">显示名</span>
          <input className="inp" value={name} readOnly />
        </label>
        <label className="field">
          <span className="lbl lbl-row">
            收款钱包地址 <Net>Base Sepolia</Net>
          </span>
          <input
            className={`inp mono${err ? ' err' : ''}`}
            autoFocus
            value={addr}
            spellCheck={false}
            onChange={(e) => {
              setAddr(e.target.value)
              setErr('')
            }}
            placeholder="0x…"
          />
        </label>
        {err && <span className="errt">{err}</span>}
        <div className="help">领取带赏金的任务前必须填写。只用于测试网收款。</div>
        <div className="dialog-actions">
          <button type="button" className="btn sec" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn pri" disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>
  )
}

/** e1 — confirmation mail sent; resend has a 60 s cooldown (`left`, owned by App). */
export function ConfirmSent(props: { email: string; left: number; onResend: () => Promise<void>; onChangeEmail: () => void }) {
  const { email, left, onResend, onChangeEmail } = props
  return (
    <div className="auth sent">
      <div className="sent-ic">✉</div>
      <div className="sent-title">验证邮件已发送</div>
      <div className="sent-copy">
        我们给 <b>{email}</b> 发了一封验证邮件，点里面的链接完成确认。
      </div>
      <button
        type="button"
        className="btn sec block"
        disabled={left > 0}
        onClick={() => void onResend()}
      >
        {left > 0 ? `重新发送（${left} 秒）` : '重新发送'}
      </button>
      <div className="sent-hint">
        没收到？看看垃圾邮件。
        <button type="button" className="link" onClick={onChangeEmail}>
          换个邮箱
        </button>
      </div>
      <div className="sent-foot">确认后即可登录，然后发布或领取任务</div>
    </div>
  )
}
