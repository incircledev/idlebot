# IdleBot 大厅场景素材 v1（设计助手 → 前端）

调性：奇幻公会 · 暖木色 + 苔绿 · 像素游戏风 · 透明底 PNG（地板除外可作 tile）

目录：`/workspace/screenshots/idlebot-scene/` 与 `public/idlebot-scene/`

| 文件 | 用途 | 建议用法 |
|------|------|----------|
| `floor-tile.png` / `-256` `-512` | 木地板可平铺 | CSS `background-repeat`，斜向木板；非完美无缝可略缩放+repeat |
| `stone-wall-window.png` | 石墙+拱窗（含一盏灯） | 侧墙装饰，可横向翻转复用 |
| `quest-board.png` | 任务公告板木框 | 热点「任务公告板」底图；板上文案仍用 DOM |
| `desk-monitor.png` | 电脑桌+显示器 | 「电脑桌 · Bot」位，桌前叠吉祥物 |
| `lantern.png` | 亮着的灯笼 | 顶挂/墙挂，可多实例缩小 |
| `round-rug.png` | 圆形地毯 | 公告板前地面 |

## 尺寸建议（页面逻辑坐标）
- 地板 tile：256（大厅 repeat）
- 墙窗：宽约 280–360 CSS px
- 公告板：宽约 220–280
- 电脑桌：宽约 140–180
- 灯笼：高约 64–96
- 地毯：直径约 120–160

## 注意
- 墙素材里已带一盏灯；独立 `lantern.png` 用于补挂点
- 公告板标题英文 QUEST BOARD 已烤在图里；中文热点标签继续用现有按钮文案叠在下方
- 忙碌态仍只靠橙 outline，不换道具图
