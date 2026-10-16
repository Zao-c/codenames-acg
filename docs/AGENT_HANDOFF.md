# Agent 续接入口

更新：2026-10-16。先读本页，再读关联文档。不要从旧 main/G0 重新开发，也不要把前任的测试记录当成本轮执行结果。

## 当前进度

- G0–G5 和 UI/拖拽已交付。应用线上 `e21aacb`（分支 `codex/cipai-phase2`，堆叠于 `codex/cipai-ui-redesign`，[PR #6](https://github.com/Zao-c/codenames-acg/pull/6)）；部署记录见 [交付记录](cipai-v2-delivery.md)。
- 第二批 P2-0～P2-5 已实现并部署：干扰可见性按主规格恢复（双方队长可见且不占手选配额）；设备键控主体、按局私有状态与 viewer 范围权限；团队关联板、队长意图、翻牌前快照、观众预测、受鉴权私密复盘。除干扰纠偏外均由 `ENABLE_MATCH_ANALYSIS` / `ENABLE_PREDICTIONS` 控制，线上默认关闭。P2-6～P2-8（社区身份与题库广场、集成发布）未开始。
- 提交前 `npm run typecheck`、`npm run test:rules`（含 match-analysis.test.ts）、`npm run test:e2e:local`（41/41）、`npm run build` 通过；正式网站浏览器验收 10 项全过（`artifacts/prod-acceptance-e21aacb/`）。
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

下一步：P2-6（社区身份与所有权认证）需先与用户确认方案；启用 `ENABLE_MATCH_ANALYSIS` / `ENABLE_PREDICTIONS` 或开放社区写入均属新的部署决定，需用户明确批准。不要反复问已批准的事项。
