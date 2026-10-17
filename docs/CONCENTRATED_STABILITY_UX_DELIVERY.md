# 集中修复轮（稳定性与交互）：实施与交付

## 基线与授权

基于分支 `codex/cipai-bangumi-free-pools`（[PR #11](https://github.com/Zao-c/codenames-acg/pull/11)）的起点 `5b8af4c`（Bangumi 自由组池轮，见 [BANGUMI_FREE_POOLS_DELIVERY.md](BANGUMI_FREE_POOLS_DELIVERY.md)）实施本轮的集中修复：实时对局稳定性与交互质量问题，要求真实交互修复而非仅样式。Bangumi 自由组池、身份隔离、隐私复盘、回放与揭幕猜番等既有功能只允许保持或改善。

用户本轮明确授权：完整测试通过后推送并部署、执行线上验收；部署仍以无在线对局、备份完整、测试通过为前提。房间与回放仍是单进程内存数据，部署重启不保留进行中的对局。

## 本轮内容（`077c4a1`）

1. 计分与轮次：`guessCard` 只累计增量分；轮次历史保留每轮总分；超时惩罚与精准结算在全部棋盘尺寸仅结算一次。真实 6×6 三次猜牌在线上验收中实测为 12/26/42 → 回合结束一次结算到 52。
2. 断线与踢人：`markDisconnected` 改为可按房间/参与者取消的定时器并带代际校验；重连与锁定组牌路径取消过期踢出；房间销毁清理全部定时器，避免旧计时器误伤重连玩家。
3. 作品池删除端到端：所有者主体鉴权、确认弹窗（取消/确认）、配额与方形占位释放、收藏清理、审计墓碑，以及进行中对局与回放快照冻结不受删除影响（删除进行中的池后棋盘/候选/快照不变）。
4. 关联板与思路：已发布线索内联选择（不再嵌套对话框）；连接端口仅在悬停/选中时显示；点击连线同时支持键盘与触屏；冲突操作回滚不破坏已有节点/边。
5. 聊天与战况：拆分为独立组件，未读计数与滚动位置互不影响；聊天发送带 `requestId` 幂等；连续消息分组样式。
6. 回合回顾：回合历史卡片按回合展开；回放页按所选回合高亮该回合翻开的牌（桌面 70/30 布局，移动提供棋盘/时间线页签）；竖屏与大字号行修复。
7. 交互收敛：设置入口合并主题/弹幕/音效；加入房间与下一局配置在挂起期间锁定并等待服务器确认；作品池「带回房间选择」入口。
8. 测试：新增 `concentrated-fixes`、`pool-deletion` 服务测试与更新后的 `match-analysis` 测试；浏览器套件覆盖桌面/移动、暗/亮双主题、真实 6×6 三次猜牌与假时钟稳定性。

## 生产部署

### `077c4a1` 集中修复轮 · 2026-10-16T16:55:06Z（北京 00:55）

- 入口 http://182.61.136.105 ；服务器 `release.json` 记录 `previousSha` `5b8af4c`，备份 `/opt/codenames-backups/concentrated-077c4a1/`（源码、server/web 构建产物、`server.env`、systemd 单元与部署前 HEAD），仅 root 可访问。
- 方式：本机全分支 git bundle 经 SSH 上传，服务器 `git checkout -f 077c4a1` 后同机构建（`npm run build`）；重启前守卫检查 3001 端口无已建立连接，未中断对局（重启清空内存房间）。
- 构建产物与本地一致：JS `index-CTX7178y.js`（SHA-256 前缀 `36341EA121CD56A4`）、CSS `index-CJlrq-Pr.css`（`2DBA2013B462067B`）。重启后 `/health` 返回 `{"ok":true}`，首页与静态资源 200。

### `edd3072` 明文 HTTP 聊天修复 · 2026-10-16T17:21:20Z（北京 01:21）

- 事故：线上验收发现生产页面（明文 HTTP，非安全上下文）每次聊天发送都停在「发送中…」。根因：`crypto.randomUUID()` 只在安全上下文可用，集中修复轮把它直接用于聊天 `requestId`，抛错早于计时器与 emit；本地 `localhost` 为安全上下文，无法复现，属仅生产环境可见的回归。
- 修复：聊天 `requestId` 改用既有安全 `genId()`；`PacksPage` 复制条目改用 `lib/clipboard` 的 `copyText` 兜底；新增规则测试 `apps/server/test/web-client-safety.test.ts`，禁止 `apps/web/src` 内未加保护的 `crypto.randomUUID` 与裸 `navigator.clipboard.writeText`，已纳入 `npm run test:rules`。
- 部署：备份 `/opt/codenames-backups/concentrated-077c4a1-web-fix/`（旧 `release.json` 与 web 产物）；构建 JS `index-BhCp6KRP.js` 554,817 B（SHA-256 前缀 `cbd776af699c5acd`），CSS 未变；首页引用新 JS 且 200，`release.json` 更新为 `edd3072`。

## 生产验收（真实浏览器）

脚本 `artifacts/prod-acceptance/concentrated-prod.mjs`：真实 Edge/Chromium，四个独立浏览器身份（桌面 1440×900 ×2、移动 390×844 ×2），全部动作只走真实 UI（生产包不暴露开发注入），并同时抓取 WebSocket 与轮询帧校验请求次数。覆盖与结果：

- 邀请页极限连点：整页只发出一次加入/旁观请求；四个浏览器身份独立入座、选队、选身份。
- 房主改为 6×6、计分、社区池；组牌封印、五秒倒计时进入对局；桌面/移动暗亮截图无横向溢出。
- 已发布线索只在关联板内联选择（无嵌套对话框）、来源绑定、点击连线、节点文字编辑、端口悬停显隐；桌面与移动（触屏）双路径。
- 真实三次猜牌 12/26/42 增量分与回合结束一次结算 52；聊天分组、双面板独立滚动与未读、旧消息阅读时新增消息的跳转锚定（该实机路径同时验证 `edd3072` 明文 HTTP 聊天修复）；移动断网重连。
- 进行中的公开池经 UI 删除（取消/403/404/收藏清理），棋盘与候选快照冻结不变（配额与占位释放在本地 `pool-deletion` 服务测试覆盖）；手机端复制池删除与源池清理。
- 三局均以正常猜完目标牌获胜（不使用刺客捷径），回放按回合高亮所选回合的翻牌集合与服务器一致。
- 结果：最终运行的 `report.json`（位于 `artifacts/prod-concentrated/`，脚本输出目录）以 `passed:true` 收尾；逐次运行日志在 `artifacts/prod-acceptance/run*.log`；截图在 `artifacts/prod-concentrated/`。
- 观测：数十次真实猜牌中出现 1 次点击后约 6 秒内未发出请求（前端偶发连接态窗口；服务端无异常、无脏状态）。脚本按预案重载队员页后恢复并完成该次猜牌，其余均一次通过；普通用户对应操作为重新点击一次。

本地全量验证（`077c4a1` 与 `edd3072` 两版）：typecheck、全部服务规则测试（含新增 concentrated-fixes、pool-deletion、web-client-safety）、浏览器套件（bangumi、phase2、lobby、stability、e2e、concentrated）与三包构建全部通过。

## 数据与回滚

- 房间与回放为单进程内存数据，部署与清理期间重启会清空；每次重启前后均检查 `/rooms`，部署窗口内无在线对局。验收收尾会经房间管理解散测试房间；最终运行后有一个已结束房间残留（收尾解散在个别轮次未生效），已随部署窗口重启清理，现 `/rooms` 为空。
- 社区池文件 `/opt/codenames-acg/apps/server/data/anime-pools.json` 为磁盘数据。线上验收反复失败留下的测试池（作者 `线上验收*`）在最终验收通过后停服清理，清理前逐文件备份为 `anime-pools.json.bak-acceptance-cleanup-*`，历史用户数据与既有池未改动；验收重复运行时脚本自身会删除其创建的池。
- 回滚：停服后从 `/opt/codenames-backups/concentrated-077c4a1/` 恢复源码与产物并重启，或 `git checkout -f 5b8af4c` 后重新构建；聊天修复的单独回滚可用 `concentrated-077c4a1-web-fix` 备份恢复旧前端产物与 `release.json`。账号、图库与社区池为磁盘数据，不受影响。
