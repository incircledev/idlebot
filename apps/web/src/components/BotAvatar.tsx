import type { BotShape } from '../lib/types'

type Props = {
  shape?: BotShape
  color?: string
  size?: number
  busy?: boolean
  title?: string
}

/** Unified IdleBot mascot avatar. shape/color kept for API compat; unused visually. */
export function BotAvatar({
  shape: _shape = 'circle',
  color: _color,
  size = 48,
  busy = false,
  title,
}: Props) {
  return (
    <div
      className={`bot-avatar${busy ? ' is-busy' : ''}`}
      style={{ width: size, height: size }}
      title={title}
      aria-label={title}
    >
      <img
        src="/idlebot-mascot-transparent-128.png"
        alt=""
        width={size}
        height={size}
        draggable={false}
      />
    </div>
  )
}
