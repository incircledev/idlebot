type Props = {
  tagline?: string
  promo?: boolean
}

/** Logo + IdleBot wordmark + 爱豆Bot sub. Spec: Idle #8B7355, Bot #3D2E1F. */
export function BrandMark({ tagline = '公会大厅 · 先到先得', promo = false }: Props) {
  return (
    <div className="brand">
      <div className="brand-row">
        <div className="brand-logo" aria-hidden="true">
          <img src="/idlebot-mascot-transparent-128.png" alt="" width={40} height={40} />
        </div>
        <div className="brand-text">
          <h1 className="wordmark" aria-label="IdleBot">
            <span className="wm-idle">Idle</span>
            <span className="wm-bot">Bot</span>
          </h1>
          <p className="brand-zh">爱豆Bot</p>
        </div>
      </div>
      {tagline && <p className="sub brand-tagline">{tagline}</p>}
      {promo && <p className="brand-promo">借一台空闲爱豆</p>}
    </div>
  )
}
