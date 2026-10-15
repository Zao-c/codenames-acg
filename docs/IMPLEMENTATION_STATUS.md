# 《词牌结社 2.0》实施状态报告

> 更新：2026-10-16。对应生产部署提交 `219dcb3`。本文是当前实际状态快照：已交付能力、遗留问题、第二批所需接口，供需求对齐与下一批开发使用。
> 权威范围提醒：功能语义与规则以《词牌结社_2.0_最终开发规格与AI执行指南.md》为准；纯视觉与交互以 UI 改版文档及衔接说明为准；本文只描述“现在实际是什么样”。第二批须先做需求差异核对与计划，Batch 3 范围未确认，不得提前实现。

## 1. 线上现状

| 项 | 值 |
| --- | --- |
| 生产入口 | http://182.61.136.105 （Nginx 80 → 前端静态产物；`/api`、`/socket.io` 代理到 Node 3001） |
| 部署提交 | `219dcb3e489c01ff64188c22abde30a20ec1d756`（分支 `codex/cipai-ui-redesign`，PR [#5](https://github.com/Zao-c/codenames-acg/pull/5)，base `codex/cipai-v2`） |
| 上一版本 | `82e391328668c78620fe74e2029c1858377430f5`（界面重做）；再前 `2c07037`（第一批交付） |
| 部署方式 | `/opt/codenames-acg` git checkout + `npm run build`（shared→server→web 同版本）+ `systemctl restart codenames.service` |
| 备份 | `/opt/codenames-backups/cipai-drag-219dcb3/before.tar.gz`（含源码、dist、release.json、git 状态）；服务器 `release.json` 记录当前/上一提交与备份路径 |
| 运行数据 | 房间与回放为单进程内存（无 Redis，重启清空）；账号、图库为磁盘数据；动画目录 1810 部、128 个池（`/api/anime/catalog` 实测） |

## 2. 已交付能力（累计至 219dcb3）

### 2.1 第一批 G0–G5（2026-10-15 部署 `2c07037`）

- G0：跨平台隔离测试、普通玩家退出不转房主、连续局回放隔离。
- G1：独立 matchId、结束原因、服务端五秒倒计时、会话重连与旧连接断线保护。
- G2：1810 部 Bangumi 缓存作品、季度池、结构化自定义池、系列映射、一键建房、封面棋盘。
- G3：独立 nextPlan、当前局中修改未来配置、队长私人书签、候补与锁定名单。
- G4：双确认启动 180 秒、10 秒保护、最后 20 秒禁抢/禁干扰、原子替换、干扰槽、双完成/超时封存、队长交接。
- G5：封存后房主五秒开局、三局切换、历局回放、手机长按/预览/文字/缩放、旧模式（经典/揭幕猜番）回归。

### 2.2 界面重做（2026-10-16 `82e3913`）

- 深海军蓝与石墨灰基底、克制面板；新增 `layout.css` 应用外壳与响应式工作区；房间按大厅/对局/结算栅格重排；手机端棋盘/玩家/聊天页签；组牌台增加筛选、书签与移动端分栏；动画棋盘紧凑封面、预览不翻牌、纯文字与缩放；移除樱花粒子与霓虹装饰。

### 2.3 候选卡交互修正（2026-10-16 `219dcb3`，本次）

- **候选卡**：移除底部「详情/收藏」文字工具条；封面为主、底部居中标题（最多两行）；书签改为独立角标星。单击/短按打开预览；拖动才是拿牌，互不误触。
- **拖拽系统**：统一指针拖拽——鼠标移动即进入拖动，触摸长按 350ms 进入拖动（长按前滑动视为页面滚动）；拖动时跟随 ghost 卡片、合法投放区高亮、无效投放静默取消。
- **投放区**：右侧阵容区 = 领取/抢夺；候选池 = 撤回（仅己方手选牌）；干扰槽 = 干扰（仅空闲作品）。手机端在拖动时出现底部固定操作坞（领取/抢夺、撤回、干扰），解决跨页签拖动问题。
- **预览窗口**：保留唯一右上角关闭（Dialog 自带 Esc、遮罩点击、焦点恢复）；删除重复的「关闭预览」按钮；保留 Bangumi 外链 `https://bgm.tv/subject/{真实作品id}`，新标签页、`rel="noopener noreferrer"`。
- **预览内动作**（按身份与归属）：空闲 → 领取 / 投放为干扰牌；己方手选 → 撤回；对方手选 → 抢夺；本方干扰牌 → 仅提示。干扰必须经过显式二次确认弹窗；最后 20 秒隐藏干扰入口（服务器仍兜底校验）。
- **隐私强化**：服务端把干扰牌在对方队长视图（`captainView.claims`）中伪装为普通手选牌（kind 改为 manual、移除 from、保护时间改为普通时间戳），仅投放方保留「干扰」角标与来源；载荷层同步掩码，不存在“先发送再隐藏”。
- **键盘/无拖拽等效路径**：预览内的动作按钮即为非拖拽玩家的完整操作路径。

## 3. 验证基线（本次部署）

- 本地全部通过：`npm run typecheck`；`npm run test:rules`（lifecycle + anime-draft，含新增掩码断言）；`npm run test:e2e:local`（揭幕猜番 41/41）；`npm run build`；`npm run test:browser:local`（10 项验收全过）。
- 线上浏览器验收（`artifacts/prod-acceptance-219dcb3/`）10 项全过：
  1. 倒计时刷新恢复；2. 下一局计划独立抽屉；3. 经典正常胜利；4. 队长重连保留组牌计时；5. 候选卡点击仅预览（无详情按钮、单一关闭、真实 Bangumi 链接）、预览领取、鼠标拖拽领取/撤回；6. 真实触摸长按拖拽到干扰槽＋显式确认、受害队长视图掩码；7. 预览不翻牌、文字、缩放、真实触摸平移/复位；8. 动画正常胜利＋显式确认；9. 三局连续与两个独立回放页；10. 深/浅色桌面 1440/1920 与触摸 390/360。
- 生产核对：`/health` ok；`/api/anime/catalog` 1810 部、128 池；首页引用 `index-jBEMMHN0.js` / `index-BZWmeLYZ.css` 且均 200；部署前 `/rooms` 为空，未中断对局。

## 4. 已知遗留与限制

1. **伪装干扰牌的「撤回」提示**：受害队长在预览中对伪装牌点「撤回」会被服务器拒绝并提示“只能撤回己方普通手选牌”。这是伪装设计的固有张力、触发概率低；若第二批做更彻底的伪装或撤回二次确认可一并处理。
2. **拖动时无边缘自动滚动**：候选池较长时，需先把目标区域滚动进视野再开始拖动（桌面与手机同）。
3. **手机跨页签拖动**：候选池与操作台分属不同页签，拖动统一使用底部操作坞，不支持拖动中切换页签（设计如此）。
4. **自定义动画作品池**仅保存在本浏览器（按昵称），跨设备不同步；公开题库社区属第二批。
5. **回放存在于内存**，服务重启即丢失；持久化回放不在本批。
6. 大量封面为外部图片懒加载，弱网首屏较慢（已有失败回退为文字封面）。

## 5. 第二批接口需求（需求对齐用，均未开始）

主规格第 7 节列出的第二批能力：团队思维板、队长私人意图图、翻牌前快照、观众私人预测、私密复盘、动画题库社区。现有架构中可复用的关键约束：

- **唯一出站点**：`packages/shared/src/view.ts` 的 `sanitizeRoom(room, viewer)` 按 viewer 收敛全部身份差异（captainView、myBookmarks、interferenceReview、干扰掩码）。第二批任何私有数据都必须新增同类 viewer-scoped 字段，禁止先下发再隐藏。
- **通信**：Socket.IO，`room_state` 全量状态 + 具名动作（如 `plan_action`、`error_message`）；服务端房间锁内提交、失败不落地。
- **隔离维度**：房间内以 `matchId` 隔离当前局/历史局；`plan.claims`、`plan.bookmarks`、`draftReview/interferenceReview` 是现成的按角色的私有数据模式。

逐个功能的接口/数据落点建议：

1. **团队思维板**：每局每队共享便签（文字 + 棋盘格坐标 + 颜色标签）。建议 `room.teamBoards[matchId][team]` + 动作 `team_board_update` 广播给同队成员（按 `viewer.team` 掩码）；需定义编辑权限（队员/队长）、观众可见性与延时公开、复盘是否公开。
2. **队长私人意图图**：队长在棋盘上的私有连线/标注。沿用 `myBookmarks` 模式：`plan.captainNotes[playerId]`，仅在 `sanitizeRoom` 中对本人输出；同时需与团队思维板共用叠加层渲染但保持权限分离。
3. **翻牌前快照**：约定时刻（建议封存完成/首张翻牌前）序列化棋盘与公开信息。建议 `room.snapshot = { at, matchId, board, revealed }`，仅结束后复用 `interferenceReview` 的 participantIds gate 输出；需定义产生时机与可见范围。
4. **观众私人预测**：观众按局提交预测（剩余卡数/胜负/顺序等）。建议 `room.predictions[spectatorId]` + 动作 `prediction_submit`；玩家视图绝不可见，结束后统一结算公开正确率；需定义预测维度与计分。
5. **私密复盘**：按角色输出各自私密信息的回放（队长视角/干扰来源/私人预测结果）。现有 `GameReplay` 是公共快照，需增加 `privateReplay(viewer)` 派生或按角色存私有片段；与第 4 节第 5 条的回放持久化决策一同处理。
6. **动画题库社区**：自定义池跨设备同步 + 公开题库提交/投票/审核。需要账号体系扩展（已有 guest/named user）、持久化存储、`/api/anime-pools` 类 CRUD、审核与版本模型、与 1810 部缓存目录的覆盖/并入关系；治理规则确认后再动工。

补充：Batch 3 范围未确认（主规格未定义），不得提前实现；第二批开始前须完成需求差异核对并产出计划。

## 6. 关键文件索引

- 组牌交互：`apps/web/src/components/DraftTile.tsx`（指针拖拽 + 单击预览）、`DraftWorkspace.tsx`（投放区/操作坞）、`AnimePlay.tsx`（dropWork、预览动作、干扰二次确认）
- 预览弹窗：`apps/web/src/components/AnimeBoard.tsx`（Preview）、`UI.tsx`（Dialog 单一关闭）
- 隐私掩码：`packages/shared/src/view.ts`
- 服务端规则：`apps/server/src/anime-draft.ts`（take/release/interfere 校验）、`game.ts`（计划动作入口）
- 验收：`scripts/browser-smoke.mjs`（10 项）、`apps/server/test/anime-draft.test.ts`、`scripts/test-local.mjs`、`scripts/test-browser-local.mjs`
- 样式：`apps/web/src/anime.css`、`layout.css`、`styles.css`
- 交付与部署记录：`docs/cipai-v2-delivery.md`
