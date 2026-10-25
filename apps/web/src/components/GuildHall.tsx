import { BotAvatar } from './BotAvatar'
import type { Account } from '../lib/types'

type Hotspot = 'bots' | 'board' | 'mine' | 'publish'

type Props = {
  bots: Account[]
  onHotspot: (h: Hotspot) => void
  me: Account
}

const HA = '/idlebot-scene/hall-assets'

const NOTES = [
  { t: 'Daily Quests', c: 'note-a' },
  { t: 'Guild Request', c: 'note-b' },
  { t: 'Idle Challenge', c: 'note-c' },
  { t: 'Resource Run', c: 'note-d' },
]

export function GuildHall({ bots, onHotspot, me }: Props) {
  const sceneBots = bots.slice(0, 4)

  return (
    <div className="hall fantasy scene-v2">
      <div className="hall-ambience" aria-hidden="true" />

      <div className="hall-stage">
        <img
          className="hall-bg-art"
          src={`${HA}/01-hall-bg-960x480.png`}
          alt=""
          draggable={false}
        />

        <div className="center-rug" aria-hidden="true">
          <img src={`${HA}/06-round-rug-380x236.png`} alt="" draggable={false} />
        </div>

        <button type="button" className="hotspot quest-board" onClick={() => onHotspot('board')} title="公告板">
          <div className="prop quest-board-frame">
            <img className="quest-board-art" src={`${HA}/07-quest-board-440x300.png`} alt="" draggable={false} />
            <div className="mini-notes">
              {NOTES.map((n) => (
                <span key={n.t} className={`sticky ${n.c}`}>
                  <b>{n.t}</b>
                </span>
              ))}
            </div>
          </div>
          <span className="hotspot-label">任务公告板</span>
        </button>

        <button
          type="button"
          className="hotspot publish-plaque"
          onClick={() => onHotspot('publish')}
          title="发布任务"
          aria-label="发布任务"
        >
          <img
            className="prop publish-sign-art"
            src={`${HA}/09-sign-publish-240x96.png`}
            alt=""
            draggable={false}
          />
        </button>

        <button type="button" className="hotspot desks" onClick={() => onHotspot('bots')} title="Bot 列表">
          <div className="desk-row">
            <div className="work-desk">
              <img src={`${HA}/08-desk-monitor-144x128.png`} alt="" draggable={false} />
            </div>
            <div className="work-desk">
              <img src={`${HA}/08-desk-monitor-144x128.png`} alt="" draggable={false} />
            </div>
          </div>
          <span className="hotspot-label">电脑桌 · Bot</span>
        </button>

        <button type="button" className="hotspot reception" onClick={() => onHotspot('mine')} title="我的任务">
          <div className="prop reception-desk">
            <img src={`${HA}/10-reception-desk-280x160.png`} alt="" draggable={false} />
          </div>
          <span className="hotspot-label">接待处 · 我的任务</span>
        </button>

        <div className="prop archives" aria-hidden="true">
          <img src={`${HA}/11-archive-cabinet-128x192.png`} alt="" draggable={false} />
        </div>
        <img className="prop plant-art p1" src={`${HA}/12-plant-80x96.png`} alt="" aria-hidden="true" draggable={false} />
        <img className="prop plant-art p2" src={`${HA}/12-plant-80x96.png`} alt="" aria-hidden="true" draggable={false} />
        <img className="hang-lantern l1" src={`${HA}/05-lantern-64x80.png`} alt="" aria-hidden="true" draggable={false} />
        <img className="hang-lantern l2" src={`${HA}/05-lantern-64x80.png`} alt="" aria-hidden="true" draggable={false} />

        <div className="scene-bots">
          {sceneBots.map((b, i) => (
            <div key={b.id} className={`scene-bot pos-${i}`}>
              <BotAvatar
                shape={b.shape}
                color={b.color ?? '#C4A882'}
                size={40}
                busy={b.status === 'busy'}
                title={`${b.name} · ${b.status === 'busy' ? '忙碌' : '空闲'}`}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="hall-footer">
        <span>你好，{me.name}{me.kind === 'bot' ? '（Bot）' : ''} · 休闲冒险中</span>
      </div>
    </div>
  )
}
