# Round 5｜稳定性修复与匿名实时组牌

基线：`0c54201`（Round 4 部署文档），功能基线 `c61ca1d`。开发在独立工作区 `/opt/codenames-round5`，生产目录 `/opt/codenames-acg` 与运行服务未修改、未重启。

## 一、现场只读检查

- 生产仓库：`/opt/codenames-acg`，分支 `codex/cipai-bangumi-free-pools`，HEAD `0c54201`
- 未提交内容：仅未跟踪文件（Round4/5 材料包、`apps/server/data/`、`release.json`），无已跟踪文件修改
- 服务：`codenames.service` active，PID 2899677，自 2026-10-18 01:01 起
- 活跃房间：0
- 持久化数据：`apps/server/data/`（users、anime-pools、anime-imports、reveal-images、anime-covers）未被本轮读取修改
- 生产构建产物 `apps/server/dist`、`apps/web/dist` 未覆盖

## 二、修复项与结论

| ID | 结论 | 实现 |
|---|---|---|
| R5-01 | 已修复 | 猜牌/结束回合改为动作级 pending：`requestId + roomId + matchId + turnKey + target`；只有目标已翻、回合键变化、明确 ACK 成功/失败或 9 秒超时才解锁。聊天/房主操作产生的 `room_state` 不再清锁。 |
| R5-02 | 已修复 | `ROOM_RECOVERY_FAILED` 若 `roomId` 与当前房间不同，仅清理旧房间凭证并直接返回，不改 `connectionState`、不清当前会话。 |
| R5-03 | 已修复 | `guide/draft/sealed` 均视为已开始的准备流程，普通 120s 大厅清理不再安排/执行踢人；guide 阶段主动退出会回到 `planning` 并重置 ready，房主可替换队长。 |
| R5-04 | 已修复 | 创建房间不再先 `leaveRoom`/清空 session：直接创建，成功后才释放旧大厅席位；失败保留 A 的房间、席位、队伍与会话。经典、动画、揭幕、自定义题库入口统一走原子流程。 |
| R5-05 | 已修复 | 封面版本化保留：每次换封面/移除封面把旧文件写入 `coverHistory`，永不因更新删除；旧回放 URL 继续可访问。软删除作品也保留历史封面。 |
| R5-06 | 已修复 | 引入 `sharp` 真实解码 + 重编码：截断/损坏 JPEG/PNG/WebP 即使头部合法也会被拒绝；限制 4MB、64–6000px、4000 万像素、禁止动图；重编码自动剥离 EXIF/XMP/文本元数据。 |
| R5-07 | 已修复 | 区分 `published`（曾公开，保证副本合法引用）与 `discoverable`（当前可被公开发现）。公开池转私人/删除/管理员隐藏后会重算发现性，新访客目录与公开搜索不再出现；已复制池、房间快照、旧回放仍可解析。 |
| R5-08 | 已修复 | `expectedUpdatedAt` 在串行写锁内再次校验；双标签页同版本更新只有一个成功，另一个 409。 |
| R5-09 | 已修复 | 自建作品列表返回 `nextOffset`/总数，按 24 条分页；`/api/anime/discovery/search` 的 manual 来源按 offset 返回下一页，前端“加载更多”生效。 |
| R5-10 | 已修复 | `room_state` 不再无条件 `setError('')`；提示/猜牌/结束回合错误按动作 scope 保留，成功或重新输入后清除。 |
| R5-11 | 确认语义并补充文案 | 复制池复制“独立选片清单”，Bangumi 与公共自建作品资料仍引用共享目录；广场、编辑器、详情弹窗均明确说明。 |
| R5-12 | 已实现 | 新增服务端过滤字段 `PublicNextPlan.publicSelectedWorkIds`：仅 `stage==='draft'` 输出，仅 `kind==='manual'`，排序稳定。非队长/旁观者不收到 claims/captainView；干扰、保护时间、操作者、队伍、书签全部不出现。 |

## 三、匿名实时组牌

### 服务端

- `sanitizeRoom()` 由可信 `plan.claims` 推导中性集合，不再把 claims 发给非授权者。
- `sealed` 后不再输出实时集合；下一局 planning 自动为空。
- 抢夺只改变 claims 的 team，集合成员不变；替换原子反映最终集合；干扰被过滤；书签不参与。
- 非队长 `plan_action` 仍被服务端拒绝。

### 客户端

- 候选卡：中性「已选入」标记，不使用红蓝边框。
- 右侧/手机新增「实时组牌 · 公共已选」只读面板：总数 + 封面/标题，无队伍、无操作者、无保护倒计时、无干扰、无书签。
- 手机新增「实时组牌 N」页签，与候选池/选牌操作互斥切换；不遮挡底部导航。
- 内容完全由 `room_state` 全量刷新，断线/切后台/新旁观者以最新服务端集合为准。

## 四、测试与证据

全部在隔离工作区运行，测试端口独立、临时数据目录：

```bash
npm run typecheck
npm run test:rules
npm run test:e2e:local
npm run build
npm run test:round5:local
npm run test:mixed:local
npm run test:stability:local
npm run test:phase2:local
npm run test:bangumi:local
npm run test:concentrated:local
npm run test:lobby:local
npm run test:browser:local
```

结果：

- `test:rules`：全部通过，新增
  - `round5-privacy.test.ts`：匿名集合、无 claims/干扰/队伍泄漏、抢夺不变、guide 掉线保席、guide 安全退出。
  - `round5-manual.test.ts`：封面历史、真实解码拒绝、并发编辑 409、分页、公开撤回、副本可用、共享资料。
- 揭幕猜番 E2E：41/41。
- `test:round5:local`：4 玩家 + 旁观者，5×5 动画组牌；guide 队长离线 > 踢人延迟仍保席；D01–D08 匿名行为；聊天 room_state 不解锁待确认猜牌；正常 14 回合胜利并中途重连；迟到 A 恢复失败不影响 B；创建房间失败保留原房间。
- 旧回归：mixed（手动+Bangumi、16 回合）、stability、phase2、bangumi、concentrated、lobby、browser 全部通过。

截图（仓库内）：

- `docs/round5-screenshots/01-public-desktop-dark.png`
- `docs/round5-screenshots/02-public-desktop-light.png`
- `docs/round5-screenshots/03-public-mobile-dark.png`
- `docs/round5-screenshots/04-public-mobile-light.png`

完整产物：本地 `artifacts/ui-acceptance-round5/`（已被 `.gitignore` 排除）。

## 五、尚未执行 / 部署前风险

- **未部署生产、未重启服务、未修改生产数据或构建产物。**
- 新增原生依赖 `sharp`；部署时需在服务器执行 `npm ci` 或 `npm install`，并确认 Linux x64 预编译包可用。
- 测试专用环境变量（**不得用于生产**）：
  - `SIMULATE_CREATE_FAILURE_AFTER`
  - `DISCONNECT_KICK_DELAY_MS`
  生产保持不设置，默认 120s。
- 封面文件采用保留策略，不做自动删除；长期需按磁盘容量做人工归档。`published` 仅作为“曾公开”标记，真正发现性由 `discoverable` 重算。
- 匿名视图不包含操作者，但队长身份本身在准备大厅/既有界面公开，玩家仍可通过聊天自行推断，属于规格允许范围。
- guide 阶段掉线保席后，若玩家长期不返回，房主仍可取消准备或替换队长；不会自动判负。

## 六、批准后的安全部署步骤

1. 备份 `apps/server/data/`、`apps/server/dist`、`apps/web/dist` 到 `/opt/codenames-backups/round5-<sha>/`。
2. 在 `/opt/codenames-acg` 切到 Round 5 提交，执行 `npm ci`（含 sharp）、`npm run build`。
3. 保持现有 systemd 配置（Round 4 的 `MANUAL_WORK_STORE_FILE`/`ANIME_COVER_DIR`），确认未设置测试变量。
4. `systemctl restart codenames`，等待 `/health`、`/api/features`、`/api/anime/catalog` 正常。
5. 生产只读浏览器检查匿名组牌页面与移动端；不创建测试数据。
6. 回滚：切回 `0c54201`，重新 `npm ci && npm run build`，恢复备份数据，重启服务。
