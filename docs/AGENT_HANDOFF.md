# Agent 续接入口

## Round 5：稳定性与匿名实时组牌（2026-10-18，已部署）

开发工作区 `/opt/codenames-round5`（独立 clone，基于 `0c54201`）。应用 `53fad47` 已于 2026-10-18 04:23 CST 部署（分支 `codex/cipai-round5-stability-anonymous-draft`），备份 `/opt/codenames-backups/round5-53fad47/`。详见 [Round 5 交付](ROUND5_STABILITY_ANONYMOUS_DRAFT.md) 与 [部署记录](ROUND5_DEPLOYMENT.md)。

- P0：动作级请求锁、迟到恢复错误隔离、guide 掉线保席、创建房间原子切换。
- P1：封面版本保留、sharp 真实解码、公开可发现性与副本使用权分离、锁内并发校验、自建作品分页。
- 新功能：draft 阶段服务端输出 `publicSelectedWorkIds` 中性只读集合；队员/旁观者可见，绝不含队伍、操作者、保护、干扰、书签。
- 测试：`npm run test:round5:local`、`round5-privacy`、`round5-manual`，以及全量 rules/E2E/build/旧浏览器回归。
- 截图：`docs/round5-screenshots/`。
- 部署前置：`npm ci`（sharp）、备份 data/dist、不得设置 `SIMULATE_CREATE_FAILURE_AFTER`/测试短踢人变量。未获授权不得部署。

## 下一轮稳定性与混合动画作品池（2026-10-18，未部署）

当前分支 `codex/cipai-bangumi-free-pools`（PR #11），基线 `1baae81`。本轮完成 P0 联机稳定性、P1 手动+Bangumi 混合作品池、P2 广场/档案/首页精修。应用 `c61ca1d` 已于 2026-10-18 01:01 CST 部署（systemd `codenames.service`），备份 `/opt/codenames-backups/round4-c61ca1d/`；重启清空内存房间。

- 必读：[本轮交付记录](ROUND4_STABILITY_MIXED_POOLS.md) 与 [生产部署记录](ROUND4_DEPLOYMENT.md)。
- 关键规则：社长离线 120 秒宽限 + 在线正式成员多数确认后接任（只移交管理权）；`submit_clue/guess_card/end_turn` 使用 requestId 幂等 + ACK；入房失败保留原房间；离线候补不会被静默晋升。
- 数据：自建作品 `apps/server/data/manual-works.json`，封面 `apps/server/data/anime-covers/`（均不提交）；手工作品 `seriesId=manual:<uuid>`、内部负数 ID，不伪造 Bangumi ID。
- 测试：`npm run test:rules`、`npm run test:e2e:local`、`npm run test:mixed:local`、`npm run test:stability:local`、`npm run test:bangumi:local`、`npm run test:phase2:local`、`npm run test:concentrated:local`、`npm run test:lobby:local`、`npm run test:browser:local`。
- 截图：`docs/round4-screenshots/`。
- 部署前置：备份 `apps/server/data/`；单进程内存房间重启即丢失；未获用户明确授权不得部署。

## 最新续接：Bangumi 自由组池与集中修复轮（2026-10-17）

当前分支 `codex/cipai-bangumi-free-pools`（[PR #11](https://github.com/Zao-c/codenames-acg/pull/11)）。生产应用 `edd3072`（2026-10-16T17:21:20Z 部署）：同日先部署 `5b8af4c` Bangumi 真实上游发现/导入与自由组池轮，再部署 `077c4a1` 集中稳定性与交互修复轮，随后 `edd3072` 修复明文 HTTP 下聊天 `requestId` 使用 `crypto.randomUUID`（仅安全上下文的 API）导致的「发送中…」冻结，并新增 `web-client-safety` 规则测试。本地全量与线上真实浏览器验收通过；记录见 [Bangumi 轮交付](BANGUMI_FREE_POOLS_DELIVERY.md) 与 [集中修复轮交付](CONCENTRATED_STABILITY_UX_DELIVERY.md)；备份在 `/opt/codenames-backups/`（`bangumi-free-pools-5b8af4c`、`concentrated-077c4a1`、`concentrated-077c4a1-web-fix`）。以下历史记录保留，不应当作当前交付状态。

## Issue #9 最新续接（2026-10-16）

在完整大厅 UI 基线 `95e9f66` 上使用已有 `codex/cipai-stability-ux-fix` 分支完成 P0/P1/P2：身份隔离与重连、跨页保席、组牌实际拖回/更换、私人预判、正式侧栏、独立结算与下一局工作区、可操作关联画布。应用 `3b8263a` 已于 18:29 部署，[PR #10](https://github.com/Zao-c/codenames-acg/pull/10)；本地全套和生产浏览器 10/10 通过，备份 `/opt/codenames-backups/issue9-3b8263a/`。详见 [Issue #9 交付](ISSUE9_DELIVERY.md)。本轮用户最新授权包括全部测试通过后的安全部署一次；此前仅本地开发的分工不再适用于本轮。以下历史记录保留，不应当作当前交付状态。

## 最新续接：首页与准备大厅 UI v2（2026-10-16）

当前分支 `codex/cipai-lobby-ui-v2`：已按用户附件重构首页公开大厅与词牌准备大厅（提交 `3b18369`，基于完整第二批 `34c85ef`），并合并 `codex/cipai-phase2-community` 取得客户端身份热修 `bca57d6` 与部署记录；该版本已于 2026-10-16 15:26 全量构建部署上线（应用 `793ea12`，[PR #8](https://github.com/Zao-c/codenames-acg/pull/8)）。组牌台、正式对局、结算页不属于本轮重构范围。详情与测试证据见 [两页 UI 交付](LOBBY_UI_V2_DELIVERY.md)，部署与线上验收记录见 [交付记录](cipai-v2-delivery.md)。

更新：2026-10-16（首页与准备大厅 UI v2 已上线，应用 `793ea12`）。先读本页，再读关联文档。部署按用户当轮指示执行（第二批 `34c85ef`、热修 `bca57d6` 同日均已上线，记录见交付文档）。不从旧 main/G0 重新开发，不把前任记录当成本轮执行结果。

## 当前进度

- G0–G5、UI/拖拽、第二批社区（P2-6/P2-7 等）、首页与准备大厅 UI v2 均已交付并上线：生产应用 `793ea12`（分支 `codex/cipai-lobby-ui-v2`，[PR #8](https://github.com/Zao-c/codenames-acg/pull/8)；同日此前为 `bca57d6` 身份热修（[PR #7](https://github.com/Zao-c/codenames-acg/pull/7)）与第二批 `34c85ef`）；部署记录见 [交付记录](cipai-v2-delivery.md)。
- 第二批 P2-0～P2-5：干扰可见性、设备键控主体、关联板/意图/快照/预测/私密复盘；线上三开关（`matchAnalysis`、`predictions`、`animeCommunity`）均已开启。
- P2-6/P2-7（社区池持久化、搜索/复制/收藏/举报/管理员治理、凭证备份/恢复、房间按池版本选题）与 P2-8 验收已完成并随 `34c85ef` 上线；配置与数据说明见 [部署交接](PHASE2_LOCAL_DELIVERY.md)。
- 提交前 `npm run typecheck`、`npm run test:rules`（含 match-analysis.test.ts）、`npm run test:e2e:local`（41/41）、`npm run build` 通过；正式网站浏览器验收 10 项全过（`artifacts/prod-acceptance-e21aacb/`）。
- 本地验收（第二批）：typecheck、rules（新增 private-replay/anime-pools）、E2E（揭幕 41/41）、build 通过；原浏览器 10/10、第二批 4/4 组，零前端异常，另测开启第二批的 390×844 完整棋盘与跨设备身份恢复。详细证据见本地交付说明；该版本（`34c85ef`）已于 2026-10-16 上线。
- 2026-10-16 13:14 起的「username 参数无效」故障为客户端本地身份被写坏（登录响应读取失败 → 空身份写入 → 自动重登 400 死循环）；已由 `bca57d6` 修复并上线：坏身份自动清理、提示重新登录。根因、验证与回滚见交付文档。
- 线上单进程内存房间/回放；服务真实工作目录 `/opt/codenames-acg/apps/server`（`USE_MEMORY_STORE=1`，社区池文件 `/opt/codenames-acg/apps/server/data/anime-pools.json`）。最近一次重启为 2026-10-16 15:26（`793ea12`，全量构建）；`bca57d6` 热修为 web-only 静态更新，未重启服务。

## 阅读顺序

1. [实际实施状态](IMPLEMENTATION_STATUS.md)：累计能力、生产基线、限制。
2. [第二批需求差异复核](PHASE2_REQUIREMENTS_REVIEW.md)：证据、规则冲突、建议默认值与待确认项。
3. [第二批架构和任务分解](PHASE2_IMPLEMENTATION_PLAN.md)：数据/权限、阶段、拟改文件、测试和回滚。
4. [历史交付记录](cipai-v2-delivery.md)：发布历史，保留原记录，不反写成全部由本任验证。
5. 用户原文在 `完整 Agent 衔接文档包/`。其主规格第 7/8 节约束第二批；交接补丁约束执行顺序；UI 文档与用户最后的克制视觉要求约束外观。文档包是用户未跟踪附件，不默认上传或移动。

## 开始开发前须知道

- 干扰可见性已按主规格恢复（`e21aacb`）：双方队长可见且不占手选配额，普通队员/观众只见静态候选集；不要再引入掩码或“二次确认”式伪装（R1 解决记录见需求复核）。
- 现有 username-only 登录不能证明账号所有权。私密复盘不能只凭名字，社区管理不能用昵称白名单。
- `sanitizeRoom` 只是主出站口，公共 REST 回放等还有独立路径；新秘密使用独立类型和受鉴权视图。
- 翻牌快照必须在真正翻牌前、同一房间锁内创建；不能挂在预览、封存或每次图编辑上。
- 主规格没有第三批定稿，等待用户补充，不能自行建立第三批范围。
- 用户未跟踪的原始文档和 `scripts/build_eihei_pet.py` 均不是本轮产物，保留原样。

下一步：本 Agent 完成本地提交并推送；部署 Agent 读取 [本地交付说明](PHASE2_LOCAL_DELIVERY.md) 的配置、数据与验收清单，按用户安排执行服务器 pull/部署。本轮用户已授权继续第二批开发及 commit/push，不要再次索取相同授权。第三批需求仍未定稿。
