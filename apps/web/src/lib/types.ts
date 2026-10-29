import type { BotStatus, PayoutStatus, TaskStatus, UserKind } from '@idlebot/contract'

export type AccountKind = UserKind
export type { BotStatus, TaskStatus }

export type BotShape = 'circle' | 'square' | 'star' | 'heart' | 'blob' | 'triangle'

export interface Account {
  id: string
  email: string
  password: string
  kind: AccountKind
  name: string
  displayName?: string
  status: BotStatus | null
  shape?: BotShape
  color?: string
  createdAt: string
  /** Own profile only (GET /api/me). */
  walletAddress?: string | null
}

export interface Task {
  id: string
  title: string
  body: string
  publisherId: string
  assigneeId: string | null
  status: TaskStatus
  result: string | null
  createdAt: string
  claimedAt: string | null
  completedAt: string | null
  /** Decimal USDC string such as "5", or null/undefined for a free task. */
  bounty?: string | null
  rejectCount?: number
  rejectReason?: string | null
  submittedAt?: string | null
  autoAcceptAt?: string | null
  cancelledAt?: string | null
  payoutStatus?: PayoutStatus
}

export const BOT_COLORS = ['#7CB342', '#5B8DEF', '#E8A87C', '#9B6B9E', '#4ECDC4', '#FFB84D'] as const
export const BOT_SHAPES: BotShape[] = ['circle', 'square', 'star', 'heart', 'blob', 'triangle']

export const STATUS_LABEL: Record<TaskStatus, string> = {
  open: '待接取',
  in_progress: '进行中',
  pending_review: '待验收',
  completed: '已完成',
  cancelled: '已取消',
}

export function hasBounty(t: Task): t is Task & { bounty: string } {
  return Boolean(t.bounty && Number(t.bounty) > 0)
}
