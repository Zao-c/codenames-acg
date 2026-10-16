# 《词牌结社 2.0》实施状态报告

> 最新续接（2026-10-16，首页/准备大厅 UI v2）：本地分支 `codex/cipai-lobby-ui-v2` 已重构用户指定两个页面并修正重复分队/动画队长同步（`3b18369`，基于完整第二批 `34c85ef`），并已合并身份热修 `bca57d6`。当前交付范围与测试以 [两页 UI 本地交付](LOBBY_UI_V2_DELIVERY.md) 为准；本轮大厅部署记录见 [交付记录](cipai-v2-delivery.md)。
> 更新：2026-10-16（第二批社区与身份热修上线）。生产应用在本轮大厅部署前为 `bca57d6`（分支 `codex/cipai-phase2-community`，[PR #7](https://github.com/Zao-c/codenames-acg/pull/7)）；第二批 P2-0～P2-8 已上线，三开关开启。
> 权威范围提醒：功能语义与规则以《词牌结社_2.0_最终开发规格与AI执行指南.md》为准；纯视觉与交互以 UI 改版文档及衔接说明为准；本文只描述“现在实际是什么样”。第二批须先做需求差异核对与计划，Batch 3 范围未确认，不得提前实现。

## 1. 线上现状

| 项 | 值 |
| --- | --- |
| 生产入口 | http://182.61.136.105 （Nginx 80 → 前端静态产物；`/api`、`/socket.io` 代理到 Node 3001） |
| 部署提交 | `bca57d6deda5c438d95899a591c0d24f8bcf9199`（分支 `codex/cipai-phase2-community`，[PR #7](https://github.com/Zao-c/codenames-acg/pull/7)；客户端身份热修，web-only 未重启） |
| 上一版本 | `34c85ef47f15b6859b971f12913926abe7713e75`（第二批社区，同日 13:13 上线）；再前 `e21aacb`（PR #6）、`219dcb3`（PR #5）、`82e3913`、`2c07037` |
| 部署方式 | `/opt/codenames-acg` git checkout + `npm run build`（shared→server→web 同版本）+ `systemctl restart codenames.service`；热修 `bca57d6` 仅重建 web 并静态替换 dist（不重启） |
| 备份 | `/opt/codenames-backups/cipai-phase2-community-34c85ef/`（全量，含 server.env 与 systemd 单元）；`/opt/codenames-backups/cipai-hotfix-bca57d6/`（热修前 web dist + release.json）；服务器 `release.json` 记录当前/上一提交与备份路径 |
| 运行数据 | 房间与回放为单进程内存（无 Redis，重启清空）；账号、图库、社区池（`/opt/codenames-acg/apps/server/data/anime-pools.json`）为磁盘数据；动画目录 1810 部、128 个池（`/api/anime/catalog` 实测） |

## 2. 已交付能力（累计至 bca57d6）

### 2.1 第一批 G0–G5（2026-10-15 部署 `2c07037`）

- G0：跨平台隔离测试、普通玩家退出不转房主、连续局回放隔离。
- G1：独立 matchId、结束原因、服务端五秒倒计时、会话重连与旧连接断线保护。
- G2：1810 部 Bangumi 缓存作品、季度池、结构化自定义池、系列映射、一键建房、封面棋盘。
- G3：独立 nextPlan、当前局中修改未来配置、队长私人书签、候补与锁定名单。
- G4：双确认启动 180 秒、10 秒保护、最后 20 秒禁抢/禁干扰、原子替换、干扰槽、双完成/超时封存、队长交接。
- G5：封存后房主五秒开局、三局切换、历局回放、手机长按/预览/文字/缩放、旧模式（经典/揭幕猜番）回归。

### 2.2 界面重做（2026-10-16 `82e3913`）

- 深海军蓝与石墨灰基底、克制面板；新增 `layout.css` 应用外壳与响应式工作区；房间按大厅/对局/结算栅格重排；手机端棋盘/玩家/聊天页签；组牌台增加筛选、书签与移动端分栏；动画棋盘紧凑封面、预览不翻牌、纯文字与缩放；移除樱花粒子与霓虹装饰。

### 2.3 候选卡交互修正（2026-10-16 `219dcb3`，前任交付）

- **候选卡**：移除底部「详情/收藏」文字工具条；封面为主、底部居中标题（最多两行）；书签改为独立角标星。单击/短按打开预览；拖动才是拿牌，互不误触。
- **拖拽系统**：统一指针拖拽——鼠标移动即进入拖动，触摸长按 350ms 进入拖动（长按前滑动视为页面滚动）；拖动时跟随 ghost 卡片、合法投放区高亮、无效投放静默取消。
- **投放区**：右侧阵容区 = 领取/抢夺；候选池 = 撤回（仅己方手选牌）；干扰槽 = 干扰（仅空闲作品）。手机端在拖动时出现底部固定操作坞（领取/抢夺、撤回、干扰），解决跨页签拖动问题。
- **预览窗口**：保留唯一右上角关闭（Dialog 自带 Esc、遮罩点击、焦点恢复）；删除重复的「关闭预览」按钮；保留 Bangumi 外链 `https://bgm.tv/subject/{真实作品id}`，新标签页、`rel="noopener noreferrer"`。
- **预览内动作**（按身份与归属）：空闲 → 领取 / 投放为干扰牌；己方手选 → 撤回；对方手选 → 抢夺；本方干扰牌 → 仅提示。干扰必须经过显式二次确认弹窗；最后 20 秒隐藏干扰入口（服务器仍兜底校验）。
- **载荷掩码（已在 `e21aacb` 移除，见 2.4）**：服务端把干扰牌在对方队长视图（`captainView.claims`）中伪装为普通手选牌（kind 改为 manual、移除 from、保护时间使用 plan.activityAt），仅投放方保留「干扰」角标与来源。此实现不能保证行为上不可辨认，并导致手选数量错误，详见第 4 节及需求复核 R1。
- **键盘/无拖拽等效路径**：预览内的动作按钮即为非拖拽玩家的完整操作路径。

### 2.4 第二批内部基础（2026-10-16 `e21aacb`）

- **P2-0 干扰可见性纠偏**：移除对受害队长的掩码，恢复主规格——双方队长均可见干扰及来源；普通队员/观众仍只见静态候选集，手选配额只统计真实手选，原「视图手选数不符、撤回被拒」冲突消失。
- **P2-1 私有状态与身份**：设备键控稳定主体（identityKey）、按局私有状态、秘密接触记录、viewer 范围权限与独立 DTO；`ENABLE_MATCH_ANALYSIS` / `ENABLE_PREDICTIONS` 默认关闭，关闭时无新私有输出。
- **P2-2～P2-5**：团队关联板（队员可写、队长只读）、队长私人意图与锁定、翻牌前快照（翻牌事务内深拷贝）、观众红蓝预测（冻结、正常结束评价、主动分享）、受鉴权私密复盘与独立入口；对应前端入口在开关关闭或无权时渲染为空（普通用户无可见变化）。
- 服务器出站仍经 `sanitizeRoom` 的 viewer 视图裁剪；公共回放与 REST 不携带私有数据。规则差异与解决记录见 [需求复核](PHASE2_REQUIREMENTS_REVIEW.md)，分阶段范围见 [实施计划](PHASE2_IMPLEMENTATION_PLAN.md)。

### 2.5 第二批社区上线与身份热修（2026-10-16 `34c85ef`、`bca57d6`）

- `34c85ef`（第二批社区）：动画题库社区、凭证备份/恢复、房间按池版本选题、私密复盘入口等上线；`matchAnalysis`/`predictions`/`animeCommunity` 三开关开启；线上验收 10 项 + 第二批 4 项全过（`artifacts/prod-acceptance-34c85ef/`）。
- `bca57d6`（客户端身份热修）：修复「登录响应读取失败 → 空身份写入 localStorage → 自动重登 400 死循环」；2xx 解析失败改为报错，身份写入与自动重登前置校验，坏身份自动清理并提示重新登录；web-only 部署未重启服务；线上注入坏身份验证零空体请求且自动恢复（`artifacts/prod-acceptance-bca57d6/`）。
- 详细记录、构建哈希与回滚方式见 [交付记录](cipai-v2-delivery.md)。

## 3. 验证基线（前任部署记录）

- 本地全部通过：`npm run typecheck`；`npm run test:rules`（lifecycle + anime-draft，含新增掩码断言）；`npm run test:e2e:local`（揭幕猜番 41/41）；`npm run build`；`npm run test:browser:local`（10 项验收全过）。
- 线上浏览器验收（`artifacts/prod-acceptance-219dcb3/`）10 项全过：
  1. 倒计时刷新恢复；2. 下一局计划独立抽屉；3. 经典正常胜利；4. 队长重连保留组牌计时；5. 候选卡点击仅预览（无详情按钮、单一关闭、真实 Bangumi 链接）、预览领取、鼠标拖拽领取/撤回；6. 真实触摸长按拖拽到干扰槽＋显式确认、受害队长视图掩码；7. 预览不翻牌、文字、缩放、真实触摸平移/复位；8. 动画正常胜利＋显式确认；9. 三局连续与两个独立回放页；10. 深/浅色桌面 1440/1920 与触摸 390/360。
- 生产核对：`/health` ok；`/api/anime/catalog` 1810 部、128 池；首页引用 `index-jBEMMHN0.js` / `index-BZWmeLYZ.css` 且均 200；部署前 `/rooms` 为空，未中断对局。

### 本轮续接独立核查

- GitHub PR #5 仍 open，head `d8db239` 与本地一致；SSH 核实生产 HEAD/release.json 为 `219dcb3`，无 tracked 修改；systemd active，Node `/health` ok，目录仍为 1810 部 / 128 池。
- 服务真实工作目录 `/opt/codenames-acg/apps/server`，该目录配置为 USE_MEMORY_STORE=1、REDIS_URL 未配置、ENABLE_ANIME_DRAFT=1。不能依据仓库根目录配置判断实际运行模式。
- 备份存在，1,129,703 bytes；清单含配置、账号、构建和图片路径；未演练恢复。检查时 `/rooms` 有 1 个房间，本轮没有进入房间、重启或部署。
- 本轮重新运行 `npm run typecheck`、`npm run test:rules`，均通过。查阅历史生产浏览器报告 passed=true、10 项、errors=[]；没有重新运行全 E2E/build/浏览器验收。
- 隔离复核脚本 `artifacts/handoff-audit.mts` 使用真实 GameService 验证干扰手选数量不一致及撤回拒绝；独立用户存储验证同名登录可再次获得有效 token。未操作真实用户数据。

### 第二批验证（2026-10-16，`e21aacb`）

- 提交前本地：`npm run typecheck`、`npm run test:rules`（含新增 `match-analysis.test.ts`）、`npm run test:e2e:local`（41/41）、`npm run build` 通过。
- 本机 `test:browser:local`：前 8 项检查通过，回放页步骤触发本机 123 请求/分钟限流边界 429；用基线 `219dcb3` 同机复现同点 429，确认非本批代码回归。
- 正式网站浏览器验收（`artifacts/prod-acceptance-e21aacb/`）：10 项全过、零前端异常，含「双方队长均可见干扰且不占手选配额」断言与两个独立回放页。

## 4. 已知遗留与限制

1. **干扰伪装冲突已按主规格修复（`e21aacb` 部署）**：移除受害队长掩码后双方队长均可见干扰及来源，手选配额只统计真实手选；原「视图手选数与实际不符、撤回被拒」随掩码移除消失。解决记录见需求复核 R1。
2. **拖动时无边缘自动滚动**：候选池较长时，需先把目标区域滚动进视野再开始拖动（桌面与手机同）。
3. **手机跨页签拖动**：候选池与操作台分属不同页签，拖动统一使用底部操作坞，不支持拖动中切换页签（设计如此）。
4. **自定义动画作品池**仅保存在本浏览器（按昵称），跨设备不同步；公开题库社区属第二批。
5. **回放存在于内存**，服务重启即丢失；持久化回放不在本批。
6. 大量封面为外部图片懒加载，弱网首屏较慢（已有失败回退为文字封面）。
7. **社区所有权已在本地独立实现**：随机设备凭证校验所有者，提供备份/恢复；管理员使用独立服务端凭证。旧 username-only 登录不认领社区资产。凭证绑定的房间身份，即使分析开关关闭，也不允许仅凭同名重新登录继承。新设备恢复凭证的浏览器验收和前队长禁入规则测试见本地交付说明。生产已开启（2026-10-16 `34c85ef` 部署核实：三开关开启）。

## 5. 第二批接口与本地实现

本轮本地新增验收均通过：typecheck、rules、E2E（揭幕 41/41）、build；原浏览器 10 项与第二批 4 组多人验收零前端异常，含社区 ID/版本快照、私密归档成员隔离、手机完整棋盘和凭证恢复。完整记录、配置和部署分工见 [本地交付说明](PHASE2_LOCAL_DELIVERY.md)。

主规格第 7 节列出的第二批能力：团队思维板、队长私人意图图、翻牌前快照、观众私人预测、私密复盘、动画题库社区。现有架构中可复用的关键约束：

- **主出站裁剪点**：`packages/shared/src/view.ts` 的 `sanitizeRoom(room, viewer)` 处理 room_state 视图；它不是全系统唯一出口。独立 Socket 事件、摘要、消息、REST、日志和公共回放也必须审查。新增秘密采用明确白名单和独立私密 DTO，禁止先下发再隐藏。
- **通信**：Socket.IO，`room_state` 全量状态 + 具名动作（如 `plan_action`、`error_message`）；服务端房间锁内提交、失败不落地。
- **隔离维度**：房间内以 `matchId` 隔离当前局/历史局；`plan.claims`、`plan.bookmarks`、`draftReview/interferenceReview` 是现成的按角色的私有数据模式。

旧版此节的若干建议与主规格不一致，已纠正：

1. **团队关联板**：默认隐藏，队员手工创建作品节点/边/文字，按当前线索/整局切换；以 matchId + cardId 关联，不能只做便签或按作品标题关联。
2. **队长意图**：当前 match 的私人图及锁定计划，不能存入 nextPlan；与团队图分开授权，交接规则明确后实现。
3. **历史快照**：每次真正翻牌之前，在同一房间锁内冻结图/意图；不是封存完成或只在首张翻牌前拍一次棋盘。克隆对象后统一提交，失败不污染内存引用。
4. **观众预测**：仅未翻牌的红/蓝预测；翻牌前冻结，正常完赛后评价，默认本人可见、主动分享、无排行榜。不得扩成胜负/顺序预测或自动公布正确率。
5. **私密复盘**：独立归档和受鉴权入口，保存当局 ACL；正常结束按规则解锁，认输/中止不追加揭密。公共 GameReplay/API 不写入私人图/预测；连续局归档与重启持久性分开处理。
6. **动画题库社区**：本地已实现结构化池持久化、发布/搜索/复制/收藏/举报/限流/管理员隐藏、独立身份备份/恢复，以及按 ID/revision 配置房间快照。与图片图库隔离，不加投票，不把池条目并入全站目录。配置与数据位置详见本地交付说明。

详细差异及待确认事项见 [需求复核](PHASE2_REQUIREMENTS_REVIEW.md)；数据结构、权限矩阵、P2-0～P2-8、测试及回滚见 [实施计划](PHASE2_IMPLEMENTATION_PLAN.md)。第三批范围仍未确认，未创建第三批规格。

## 6. 关键文件索引

- 组牌交互：`apps/web/src/components/DraftTile.tsx`（指针拖拽 + 单击预览）、`DraftWorkspace.tsx`（投放区/操作坞）、`AnimePlay.tsx`（dropWork、预览动作、干扰二次确认）
- 预览弹窗：`apps/web/src/components/AnimeBoard.tsx`（Preview）、`UI.tsx`（Dialog 单一关闭）
- 隐私掩码：`packages/shared/src/view.ts`
- 第二批私密基础：`apps/server/src/match-analysis.ts`、`predictions.ts`、`private-replay.ts`、`private-identity.ts`；`packages/shared/src/analysis.ts`、`analysis-view.ts`；前端 `AssociationBoard.tsx`、`SpectatorPredictions.tsx`、`PrivateReview.tsx`（开关关闭或无权限时渲染为空）
- 服务端规则：`apps/server/src/anime-draft.ts`（take/release/interfere 校验）、`game.ts`（计划动作入口）
- 验收：`scripts/browser-smoke.mjs`（10 项）、`apps/server/test/anime-draft.test.ts`、`scripts/test-local.mjs`、`scripts/test-browser-local.mjs`
- 样式：`apps/web/src/anime.css`、`layout.css`、`styles.css`
- 交付与部署记录：`docs/cipai-v2-delivery.md`
