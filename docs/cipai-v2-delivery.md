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

## 第二批内部基础部署结果（2026-10-16 · e21aacb）

- 北京时间 11:05（03:05 UTC）部署应用提交 `e21aacb285cf3c5a9f3fcdb713c827da90be89d1`（分支 `codex/cipai-phase2`，[PR #6](https://github.com/Zao-c/codenames-acg/pull/6) 指向该提交），入口：http://182.61.136.105 。服务器 release.json 已更新（上一版 `219dcb3`）。
- 范围（P2-0～P2-5，均为已提交的既有改动，本次仅部署）：按主规格恢复干扰双方队长可见（普通队员/观众仍只见静态候选集，手选配额只计真实手选）；设备键控主体、按局私有状态与 viewer 范围权限；团队关联板、队长意图、翻牌前快照、观众预测、受鉴权私密复盘。除干扰纠偏外由 `ENABLE_MATCH_ANALYSIS` / `ENABLE_PREDICTIONS` 控制，线上保持默认关闭，对玩家无新私有输出。P2-6～P2-8 与第三批未实现。
- 部署前核对：`/rooms` 无活跃对局（原大厅房间在部署窗口内因主机重启清空，房间可放弃已获用户确认）；备份：`/opt/codenames-backups/cipai-phase2-e21aacb/`（before.tar.gz 1,135,610 B、systemd 单元、原 HEAD、工作区状态、部署前 release.json），目录仅 root 可访问。
- 构建与重启：shared/server/web 三包同版本构建通过，前端产物哈希与本地一致（`index-DhM55g6T.js` / `index-CJIiiBhg.css`）。构建期间服务器出现持续内存压力（journal 10:37–10:52），随后主机发生一次重启（10:54 恢复）；systemd 自动拉起服务并运行新构建，账号数据（80 个账号）解析正常。shared/server 构建在重启前已完成，web 构建在恢复后按单包、限内存方式补完。
- 核验：systemd active，/health 返回 ok，`/api/anime/catalog` 1810 部 / 128 池，`/rooms` 为空；Nginx 首页引用新产物且 JS/CSS 均 200。
- 正式网站浏览器验收（`artifacts/prod-acceptance-e21aacb/`，四客户端：两个桌面 1440/1920 + 两个手机触摸 390/360，经典→动画 6×6→经典三局连续）10/10 通过、零前端异常；含新规则断言：真实触摸长按干扰＋二次确认后双方队长均可见干扰且不占手选配额；两个独立回放页正常。
- 提交前本地回归：`npm run typecheck`、`npm run test:rules`（含新增 match-analysis.test.ts）、`npm run test:e2e:local`（41/41）、`npm run build` 通过。`test:browser:local` 前 8 项检查通过，回放页步骤触发本机 123 请求/分钟限流边界 429；用基线 `219dcb3` 同机复现相同计数与同点 429，确认非本批代码回归（正式网站验收未触发）。
- 回滚：停服务后从该备份恢复源码与 dist 并重启，或 `git checkout -f 219dcb3` 后重新 build；账号与图库磁盘数据不受影响。新 schema（`privateMatch` 等）只在开关启用时写入，线上开关默认关闭，回滚窗口内无进行中依赖。

## 第二批社区部署结果（2026-10-16 · 34c85ef）

- 北京时间 13:13 部署应用提交 `34c85ef47f15b6859b971f12913926abe7713e75`（分支 `codex/cipai-phase2-community`，[PR #7](https://github.com/Zao-c/codenames-acg/pull/7) 指向该提交），入口：http://182.61.136.105 。服务器 release.json 已更新（上一版 `e21aacb`），deployedAt `2026-10-16T05:13:54Z`。
- 范围（P2-6/P2-7 与 P2-8 验收）：动画题库社区（公开搜索、复制、收藏、举报、管理员隐藏/恢复与处理记录）、私有身份凭证备份/恢复、房间按社区池 ID+revision 选题快照、私密复盘入口等；三个开关 `ENABLE_ANIME_COMMUNITY` / `ENABLE_MATCH_ANALYSIS` / `ENABLE_PREDICTIONS` 首次开启；社区池文件 `ANIME_POOL_STORE_FILE=/opt/codenames-acg/apps/server/data/anime-pools.json`。社区验收所用测试池已隐藏。
- 部署前核对与备份：`/opt/codenames-backups/cipai-phase2-community-34c85ef/`（before.tar.gz 1,170,094 B，含源码、dist、原 release.json、server.env、systemd 单元与原 HEAD；目录仅 root 可访问）。
- 构建与重启：shared/server 13:09、web 13:10 三包同版本构建；web 产物 `index-BPj5KJiv.js`（498,464 B）/ `index-SJEPYXVX.css`（95,555 B）；13:13:09 重启 `codenames.service`。
- 核验与验收：systemd active；Nginx 首页引用新产物且 JS/CSS 均 200。正式网站浏览器验收：`artifacts/prod-acceptance-34c85ef/report.json` 10 项全过（四客户端桌面 1440/1920 + 手机触摸 390/360，经典→动画三局连续，含双方队长可见干扰且不占手选配额），零前端异常；第二批联机验收 `artifacts/prod-acceptance-34c85ef/phase2/report.json` 4 项全过（社区创建/私有身份/复制/收藏/移动主题/举报与管理员隐藏恢复、按池版本封存 36 卡对局、团队图与私密意图/预测/快照/受权私密复盘无公共泄漏、线索快照与跨设备身份恢复）。
- 回滚：停服务后从该备份恢复源码、dist、server.env 并重启，或 `git checkout -f e21aacb` 后重新 build；账号、图库与社区池文件为磁盘数据，不受影响。

## 客户端身份热修部署结果（2026-10-16 · bca57d6）

- 事故：上述部署（13:13）后约一分钟（13:14 起），用户本机在登录页/个人资料处持续报「username 参数无效」（`POST /api/users/login` 返回 400，响应体 `{"message":"username 参数无效"}`）。nginx 日志显示全部 400 均来自该用户本机浏览器；服务端账号数据与配置正常。
- 根因（客户端）：13:14:11 一次登录 `HTTP 200`（响应体 284,404 B）在浏览器端读取失败；`api.ts` 的 `request()` 把 2xx 响应体解析失败静默当作成功（`response.json().catch(() => ({}))`）→ 自动重登链路把空身份 `{"mode":"named"}`（无 username）写入 localStorage → 此后每次页面加载自动重登都发送 `{}`，服务端按 username 缺失拒绝，形成 400 死循环。Chrome Storage 写入时间线与 nginx 日志互证；本地用坏身份基线复现了死循环。
- 修复 `bca57d6`（web-only，4 文件 +210/−6）：`api.ts` 2xx 解析失败改为抛错（“服务器响应异常，请重试”）；`GameContext` 自动重登前置校验 username，缺失则清理本地身份并提示重新登录，三处身份写入前校验；`storage.ts` 拒绝写入无 username 的 named 身份、过滤最近用户空项；新增回归脚本 `scripts/repro-identity-recovery.mjs`。
- 本地验证：修复前基线复现（空体登录 + 400 死循环）；修复后专项 9/9（坏身份不再触发登录请求、自动清理并提示重登；正常登录、历史清理与健康路径无回归）；`npm run typecheck`、`npm run build -w @acg-codenames/web`、`test-browser-local.mjs` 10/10、`--phase2` 4/4 全过。
- 部署（web-only 静态更新，未重启服务）：git bundle 同步（`34c85ef..bca57d6`）→ `git checkout -f bca57d6` → 仅 `npm run build -w @acg-codenames/web`（nice 降优先级 + 限内存），产物哈希与本地一致（JS `a6637a64…` / CSS `d437cc77…`）。Node 进程 PID 226174 保持未重启，房间/会话不受影响。
- 备份与元数据：`/opt/codenames-backups/cipai-hotfix-bca57d6/`（before-web-dist.tar.gz 170,758 B、部署前 release.json、原 HEAD）；release.json deployedAt `2026-10-16T07:07:00Z`。
- 线上验收（`artifacts/prod-acceptance-bca57d6/`）：对生产站点注入坏身份载入后——新产物 `index-CQtGKyj-.js` 200（旧产物 404）、零登录请求、本地身份自动清空、提示「本地登录信息已失效，请重新登录」、最近用户仅显示 `Sparrow`；截图 `corrupted-identity-recovery.png`。
- 用户恢复：受影响的浏览器在热修后首次加载会自动清理坏身份并提示重新登录，重登一次即恢复；无需清缓存或手动操作。
- 回滚：`git checkout -f 34c85ef` 后仅重建 web 并替换 dist（无需重启服务），或直接还原备份中的 `before-web-dist.tar.gz`；服务端与磁盘数据不受影响。
- 说明：本记录为纯文档提交（不含代码）；线上应用仍为 `bca57d6` 及其构建产物。
