const HA = '/idlebot-scene/hall-assets'

/** Decorative darkened guild-hall scene behind login/register. Not interactive. */
export function AuthHallBackdrop() {
  return (
    <div className="auth-hall-bg" aria-hidden="true">
      <div className="hall fantasy auth-mini-hall scene-v2">
        <div className="hall-ambience" />
        <div className="hall-stage">
          <img className="hall-bg-art" src={`${HA}/01-hall-bg-960x480.png`} alt="" draggable={false} />
          <div className="center-rug">
            <img src={`${HA}/06-round-rug-380x236.png`} alt="" draggable={false} />
          </div>
          <div className="prop quest-board-frame auth-static-board">
            <img className="quest-board-art" src={`${HA}/07-quest-board-440x300.png`} alt="" draggable={false} />
            <div className="mini-notes">
              <span className="sticky note-a"><b>Daily Quests</b></span>
              <span className="sticky note-b"><b>Guild Request</b></span>
              <span className="sticky note-c"><b>Idle Challenge</b></span>
              <span className="sticky note-d"><b>Resource Run</b></span>
            </div>
          </div>
          <img
            className="prop publish-sign-art auth-static-publish"
            src={`${HA}/09-sign-publish-240x96.png`}
            alt=""
            draggable={false}
          />
          <div className="desk-row auth-static-desks">
            <div className="work-desk"><img src={`${HA}/08-desk-monitor-144x128.png`} alt="" draggable={false} /></div>
            <div className="work-desk"><img src={`${HA}/08-desk-monitor-144x128.png`} alt="" draggable={false} /></div>
          </div>
          <div className="prop reception-desk auth-static-reception">
            <img src={`${HA}/10-reception-desk-280x160.png`} alt="" draggable={false} />
          </div>
          <div className="prop archives">
            <img src={`${HA}/11-archive-cabinet-128x192.png`} alt="" draggable={false} />
          </div>
          <img className="prop plant-art p1" src={`${HA}/12-plant-80x96.png`} alt="" draggable={false} />
          <img className="prop plant-art p2" src={`${HA}/12-plant-80x96.png`} alt="" draggable={false} />
          <img className="hang-lantern l1" src={`${HA}/05-lantern-64x80.png`} alt="" draggable={false} />
          <img className="hang-lantern l2" src={`${HA}/05-lantern-64x80.png`} alt="" draggable={false} />
          <div className="scene-bots">
            <div className="scene-bot pos-0"><img className="deco-bot" src="/idlebot-mascot-transparent-128.png" alt="" width={36} height={36} /></div>
            <div className="scene-bot pos-1"><img className="deco-bot" src="/idlebot-mascot-transparent-128.png" alt="" width={36} height={36} /></div>
            <div className="scene-bot pos-2"><img className="deco-bot" src="/idlebot-mascot-transparent-128.png" alt="" width={36} height={36} /></div>
          </div>
        </div>
      </div>
      <div className="auth-veil" />
    </div>
  )
}
