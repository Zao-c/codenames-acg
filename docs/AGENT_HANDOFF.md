# Agent 续接入口

## 最新续接：首页与准备大厅 UI v2（2026-10-16）

当前本地开发分支为 `codex/cipai-lobby-ui-v2`，基于完整第二批 `34c85ef`。本轮按用户新附件实际重构首页公开大厅及词牌准备大厅；组牌台、正式对局、结算页不属于本轮重构范围。详情与测试证据见 [两页 UI 本地交付](LOBBY_UI_V2_DELIVERY.md)。用户已授权本地开发、测试、commit、push；服务器 pull 与部署由其他 AI 执行。

本轮已只读核对 GitHub PR #7 与服务器：线上 HEAD/release.json 为 `34c85ef47f15b6859b971f12913926abe7713e75`，服务 active；尚未部署本轮 UI。以下是上一轮本地社区交付时的历史状态，不应覆盖本段较新的核对结果。

更新：2026-10-16（本地社区交付）。先读本页，再读关联文档。用户已明确分工：本 Agent 仅本地开发/测试/commit/push，服务器部署和 pull 由其他 AI 负责。不从旧 main/G0 重新开发，不把前任记录当成本轮执行结果。

## 当前进度

- G0–G5 和 UI/拖拽已交付。应用线上 `e21aacb`（分支 `codex/cipai-phase2`，堆叠于 `codex/cipai-ui-redesign`，[PR #6](https://github.com/Zao-c/codenames-acg/pull/6)）；部署记录见 [交付记录](cipai-v2-delivery.md)。
- 第二批 P2-0～P2-5 已有基础提交：干扰可见性、设备键控主体、关联板/意图/快照/预测/私密复盘。前任记录其已部署，新功能开关默认关闭；本轮不登录服务器复核。
- 本地分支 `codex/cipai-phase2-community` 继续完成 P2-6/P2-7：社区池持久化、搜索/复制/收藏/举报/管理员治理、凭证备份/恢复、房间按池版本选题；补齐 P2-8 的本地验收和 [部署 Agent 交接](PHASE2_LOCAL_DELIVERY.md)。本轮未部署。
- 提交前 `npm run typecheck`、`npm run test:rules`（含 match-analysis.test.ts）、`npm run test:e2e:local`（41/41）、`npm run build` 通过；正式网站浏览器验收 10 项全过（`artifacts/prod-acceptance-e21aacb/`）。
- 本轮本地验收：typecheck、rules（新增 private-replay/anime-pools）、E2E（揭幕 41/41）、build 通过；原浏览器 10/10、第二批 4/4 组，零前端异常，另测开启第二批的 390×844 完整棋盘与跨设备身份恢复。详细证据见本地交付说明；以上不等于新版本已上线。
- 线上是单进程内存房间/回放；服务真实工作目录 `/opt/codenames-acg/apps/server`。部署核验后 `/rooms` 已出现真实玩家房间（重启会清空）。

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
