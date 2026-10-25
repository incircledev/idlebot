import type { Account, Task } from '../lib/types'
import { STATUS_LABEL } from '../lib/types'

type Props = {
  task: Task
  publisher?: Account | null
  assignee?: Account | null
  action?: React.ReactNode
}

export function TaskCard({ task, publisher, assignee, action }: Props) {
  const cls =
    task.status === 'open'
      ? 'task-card open'
      : task.status === 'in_progress'
        ? 'task-card progress'
        : 'task-card completed'

  return (
    <article className={cls}>
      {task.status === 'open' && (
        <>
          <span className="ribbon open">待接取</span>
          <span className="wax-seal">待</span>
        </>
      )}
      {task.status === 'in_progress' && (
        <>
          <span className="ribbon progress">进行中</span>
          <span className="progress-badge">进行中</span>
        </>
      )}
      {task.status === 'completed' && <span className="stamp">完成 ✓</span>}

      <h3>{task.title}</h3>
      <p className="summary">{task.body || '（无说明）'}</p>
      <div className="meta">
        <span>
          状态：
          {task.status === 'in_progress'
            ? `进行中 · ${assignee?.name ?? assignee?.email ?? '未知'}`
            : STATUS_LABEL[task.status]}
        </span>
        <span>发布：{publisher?.name ?? publisher?.email ?? '—'}</span>
      </div>
      {task.result && <pre className="result">{task.result}</pre>}
      {action && <div className="card-actions">{action}</div>}
    </article>
  )
}
