# 词牌结社 2.0 第一批交付记录

日期：2026-10-15。仓库基线 `1b8a870`；用户明确授权分阶段实现第一批 B 并部署。

## 阶段和文件

| 阶段 | 实现 | 主要文件 |
| --- | --- | --- |
| G0 | 跨平台隔离测试、普通玩家退出不转房主、连续局回放隔离 | scripts/test-local.mjs、game.ts、lifecycle.test.ts |
| G1 | 独立 matchId、结束原因、服务端五秒倒计时、会话重连与旧连接断线保护 | shared/types.ts、game.ts、index.ts |
| G2 | 1810 部 Bangumi 缓存作品、季度池、结构化自定义池、系列映射、一键建房、封面棋盘 | resources/anime-*.json、anime-catalog.ts、AnimePlay.tsx、HomePage.tsx |
| G3 | 独立 nextPlan、当前局中修改未来配置、队长私人书签、候补与锁定名单 | shared/anime.ts、game.ts、AnimePlay.tsx |
| G4 | 双确认启动 180 秒、10 秒保护、最后 20 秒禁抢/干扰、原子替换、干扰槽、双完成/超时封存、交接 | anime-draft.ts、game.ts、anime-draft.test.ts |
| G5 | 封存后房主五秒开局、三局切换、历局回放、手机长按/预览/文字/缩放、旧模式回归 | browser-smoke.mjs、test-browser-local.mjs、e2e.ts、reveal-guess.e2e.ts |

源码路径中的 game.ts 等均位于 apps/server/src；前端组件位于 apps/web/src/components。

## 已运行验证

- `npm run typecheck`：通过。
- `npm run test:rules`：通过。真实 GameService 三局流程，10/160/180 秒边界、并发抢占、保护、原子失败、交接、前队长禁猜、隐私、系列修正、5×5/6×6 配额、小池连续复用。
- `npm run test:e2e:local`：通过。经典房间、词库/图库、身份、回放、清理等回归；揭幕猜番 41/41。
- `npm run test:browser:local`：通过。4 个浏览器上下文，其中 2 个手机触摸视口；经典→动画 6×6→经典，刷新倒计时、下一局配置、真实触摸长按干扰、预览不翻牌、文字/缩放、两个独立历史回放；无前端异常。
- `npm run build`：通过。共享包、服务端和前端完整构建。
- 浏览器证据写入本地忽略目录 `artifacts/browser-smoke/`，不包含真实用户数据。

## 权限与数据边界

- 普通队员/观众只看到固定候选集合；归属、保护、完成状态仅队长可见。书签只对本人可见。
- 预定下局队长不会获得当前局队长视野。封存棋盘不会通过 room_state 传出。
- 组牌在房间锁内操作，失败不提交；正式开局才记录系列历史。所有补位严格限定当前所选题库。
- 正常结束的房间复盘可显示干扰来源；认输不展示新增干扰秘密；公共回放不携带私有组牌状态。
- 自定义动画作品池在本浏览器按昵称保存；选中的作品池快照存在房间里。跨设备云同步和公开动画题库社区属于后续能力。
- 系列标识采用标题季数归一化及可编辑显式修正，包含轻音、高达 SEED、Fate 子系列回归案例；尚非完整 Bangumi 关系图，新增错误映射可在 anime-series-overrides.json 修正。
- 封面来自外部图片服务；失败显示文字，目录和联机玩法不依赖实时 Bangumi API。

## 线上原有差异保留

部署前发现服务器基于 `ddb6e47`，有尚未进入 GitHub 的源码修改。已下载只读快照并合入：揭幕猜番 PrepRoom/RevealGuessBoard、批量题目增删改排序、图库管理 UI，以及经典大厅 2 小时、揭幕准备/活动期等保留时长。保留仓库最新图片外置存储行为及连接保护，相关旧测试一起纳入回归。

## 部署与回滚

- 目标：`182.61.136.105`，目录 `/opt/codenames-acg`，systemd `codenames.service`，Node 22，Nginx 80。
- 共享包、服务端和前端必须作为同一版本发布。部署前确认房间为空，并备份源码、构建、.env、账号与图库数据；不覆盖真实数据和原 .env 内容。
- 完成测试后在服务端 .env 设置 `ENABLE_ANIME_DRAFT=1`。设为 0 可停止新动画准备入口；已进行的新版组牌不能直接交给旧版本程序处理。
- 当前使用单进程内存房间存储，没有 Redis；正常断线重连可恢复，服务进程重启后房间和内存回放不会恢复。账号与图库为磁盘数据，部署保留。
- 回滚先确认无人游戏，停服务，从本次服务器备份恢复程序和原 .env，再启动并检查 /health。不要用旧数据备份覆盖上线后新增的账号/图库数据。
- Git 回滚按依赖逆序处理；线上部署的是功能分支完整版本，PR 保留独立审阅入口。

## 后续边界

本批不包含团队关联图、思路图、观众预测和动画社区治理。无需为这些第二批功能阻塞第一批联机。

## 正式部署结果

- 2026-10-15 19:45（北京时间）已部署应用提交 `2c07037ed18840cbc5d339caf49f025fccc62868`，入口：http://182.61.136.105 。服务器 release.json 记录应用提交与备份位置。
- 完整备份：`/opt/codenames-backups/cipai-v2-2c07037/before.tar.gz`，目录仅 root 可访问；另存 systemd 单元、原 Git HEAD 和工作区状态。
- 部署前对已下载的线上修改文件逐个比较 SHA-256，确认没有并发改动；备份前后均确认无在线房间。
- systemd active，Nginx /health 返回 ok，动画目录返回 1810 部。
- 正式网站也通过四游客客户端、两手机视口、三局连续完整浏览器验收；回放接口均成功，零前端异常。结束后测试房间已解散，/rooms 返回空数组。
- 分阶段 PR：[#1 G0](https://github.com/Zao-c/codenames-acg/pull/1) → [#2 G1](https://github.com/Zao-c/codenames-acg/pull/2) → [#3 G2–G4](https://github.com/Zao-c/codenames-acg/pull/3) → [#4 G5](https://github.com/Zao-c/codenames-acg/pull/4)。均保留开放审阅状态，线上运行完整功能分支构建。

## 界面重做部署结果（2026-10-16）

- 02:08（北京时间）部署应用提交 `82e391328668c78620fe74e2029c1858377430f5`（分支 `codex/cipai-ui-redesign`，[PR #5](https://github.com/Zao-c/codenames-acg/pull/5)），入口：http://182.61.136.105 。服务器 release.json 记录应用提交与备份位置。
- 本次为纯前端布局重做：深海军蓝与石墨灰基底、克制面板，动画封面为主视觉；新增 layout.css 应用外壳与响应式工作区，房间按大厅/对局/结算栅格重排，手机端棋盘/玩家/聊天页签切换；组牌台增加筛选、书签与移动端分栏；动画棋盘紧凑封面、预览不翻牌、纯文字与缩放；移除樱花粒子与霓虹装饰。
- 部署前核对：服务器工作区与上一版 `2c07037` 逐文件 SHA-256 一致（61 个差异文件 CR 归一化后全部相同，仅 release.json 为部署元数据），确认无未合入的线上修改；重启前 /rooms 为空，未中断任何对局。
- 依赖与后端无变化，未执行 npm ci；`npm run build` 三个包同版本构建通过，前端产物哈希与本地一致。备份：`/opt/codenames-backups/cipai-ui-82e3913/before.tar.gz`（含源码、dist、.env、账号数据与 git 状态），目录仅 root 可访问。
- systemd `codenames.service` 重启后 active，Nginx /health 返回 ok，动画目录 1810 部，/rooms 无测试残留（验收测试房间在结束流程中解散）。
- 正式网站浏览器验收：四游客客户端、两台手机触摸视口、经典→动画 6×6→经典三局连续、真实触摸长按干扰、预览不翻牌、缩放滑动、两个独立回放页，全部通过，零前端异常。
- 回滚：停服务后从该备份恢复源码与 dist 并重启，或 `git checkout -f 2c07037` 后重新 build；账号与图库磁盘数据不受影响。

## 候选卡交互修正部署结果（2026-10-16 · 219dcb3）

- 北京时间 15:46（07:46 UTC）部署应用提交 `219dcb3e489c01ff64188c22abde30a20ec1d756`（分支 `codex/cipai-ui-redesign`，[PR #5](https://github.com/Zao-c/codenames-acg/pull/5) 已自动指向该提交），入口：http://182.61.136.105 。服务器 release.json 已更新（上一版 `82e3913`）。
- 本次为 UI/UX 与拖拽交互修正：候选卡移除底部「详情/收藏」工具条，书签改为独立角标星；单击/短按打开预览、拖动拿牌（鼠标移动即拖、触摸长按 350ms 进入拖动），带跟随 ghost、投放区高亮与手机底部操作坞（领取/抢夺、撤回、干扰）；预览窗口合并为单一右上关闭并保留 Bangumi 外链（新标签页）；预览内按身份给出领取/撤回/抢夺/干扰动作，干扰必须经过显式二次确认；服务端把干扰牌在对方队长视图里伪装为普通手选（仅投放方保留角标与来源）。
- 部署前核对：`/rooms` 为空，未中断任何对局；备份含源码、dist、release.json 与 git 状态：`/opt/codenames-backups/cipai-drag-219dcb3/before.tar.gz`，目录仅 root 可访问。
- 后端规则与依赖无变化；shared 增加视图层掩码。`npm run build` 三包同版本构建通过，产物哈希与本地一致（`index-jBEMMHN0.js` / `index-BZWmeLYZ.css`）。
- systemd `codenames.service` 重启后 active，/health 返回 ok，`/api/anime/catalog` 返回 1810 部作品、128 个池，/rooms 为空；Nginx 首页引用新产物且 JS/CSS 均 200。
- 正式网站浏览器验收（四客户端：两个桌面 1440/1920 + 两个手机触摸 390/360，经典→动画 6×6→经典三局连续）：点击候选卡只开预览（无「详情」按钮、单一关闭入口、Bangumi 外链 `target=_blank rel="noopener noreferrer"`）、预览内领取、鼠标拖拽领取与拖回撤回、真实触摸长按拖到干扰槽并二次确认、受害队长视图与载荷均无干扰标记、预览不翻牌、文字/缩放/滑动、两个独立回放页——全部通过，零前端异常。
- 回滚：停服务后从该备份恢复源码与 dist 并重启，或 `git checkout -f 82e3913` 后重新 build；账号与图库磁盘数据不受影响。
