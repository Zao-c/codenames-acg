# 下一轮稳定性与混合动画作品池 · 交付记录

基线：PR #11 / `codex/cipai-bangumi-free-pools`，起始提交 `1baae81`。本轮未部署生产，未改动线上数据。

## 一、P0 联机稳定性（已实现并测试）

### 1. 房间锁与离线任务竞态

- `GameService` 的房间锁改为「每次获取一个 token」：`AsyncLocalStorage` 里传播的旧 token 在锁释放后失效，`setTimeout` 回调不会再误判自己仍持有房间锁。
- 覆盖场景：断线 → 重连 → 再次断线、过期瞬间并发 `setTeam` / `markDisconnected` / `reconnectRoom`。
- 依据：`apps/server/test/stability-round.test.ts` 第 5 组。

### 2. 猜牌 / 提示 / 结束回合可靠提交

- 三个事件都接受 `requestId`（8–128 位安全字符），服务端在房间内保留 15 分钟请求日志：
  - 相同 `requestId` 重放直接返回当前房间，不重复翻牌/出题/换边。
  - 被拒绝的请求不写入日志，客户端修正后可换新 `requestId` 重试。
- Socket ACK 返回 `{ ok, message, duplicate, roomId, roomVersion, turnVersion }`；服务端拒绝时先回推最新 `room_state`。
- 客户端：
  - 提示提交成功后**才**清空输入；失败或超时保留提示词与数字。
  - 猜牌/结束回合等待期间只锁自己的操作；9 秒未确认则解锁并主动 `sync_room_state`，不盲目重发。
  - 页面从后台回到前台、Socket 重连后都会同步最新局面。
- 依据：`stability-round.test.ts` 第 1 组；浏览器 `browser-mixed.mjs` 的双击/断线场景。

### 3. 社长失联与安全接任

最终规则（服务端强制）：

1. 社长没有活跃 Socket 时记录 `hostOfflineSince`。
2. 连续离线 **120 秒**（`HOST_TAKEOVER_GRACE_MS` 可配，测试用 40ms）后，在线正式玩家可发起接任。
3. 其他在线正式玩家（排除原社长与候选人）多数确认后完成转让；只有 1 名玩家在线时，宽限期后直接接任。
4. 请求串行处理；同一时间只允许一个待确认请求；候选人离线或原社长回归会取消请求。
5. 转让只改 `hostPlayerId` / `isHost`，**不改变阵营、队长、干扰牌、私人图谱或预判**；新社长若是普通队员，仍看不到未翻牌阵营。
6. 原社长回归后只是普通成员，不能自动抢回。
7. 新社长可用既有权限安全中止本局（`force_end_game`），不会判对方自动获胜。
8. 准备阶段社长离线仍保留原有 120 秒清理定时器；清理时重新加锁，不会误删已重连席位。

前端在房间顶部显示离线秒数、宽限倒计时、接任候选人、确认/拒绝按钮。测试：
`stability-round.test.ts` 第 2–3 组；`browser-stability.mjs`。

### 4. 安全切房

- 客户端不再先退出 A：直接向 B 发起加入；B 失败时保留 A 的会话、房间、队伍与席位，只显示带房间号的入房错误。
- B 成功后才释放 A 的大厅席位（对局中则保留可恢复席位）。
- 旧房间自动恢复失败：
  - 后台恢复失败：静默清理失效凭证，不再在首页弹红色「房间已过期」。
  - 主动打开失效邀请：就地显示原因与返回入口。
  - 对局中房间突然丢失：显示阻断提示，不会静默跳首页。
- 错误信息绑定 `roomId + action`，旧异步错误不能清理新房间的有效会话。
- 依据：`stability-round.test.ts` 第 6 组；`browser-stability.mjs` 跨页面/多标签场景。

### 5. 候补晋升

- 只有「在线 + 有可恢复 session」的候补才会在结算/回大厅时晋升。
- 离线候补保留旁观席位与队列顺序，但不会被静默晋升；重新上线后仍可继续排队。
- 依据：`stability-round.test.ts` 第 4 组。

## 二、P1 手动动画 + Bangumi 混合作品池

### 数据模型

- 手工作品使用稳定 `manual:<uuid>` 作为 `seriesId`/展示键；内部数字 `id` 为持久化的负整数，绝不复用 Bangumi 正数 ID。
- 字段：标题、原名/别名、封面引用、来源、`seriesKey`、可选年份/类型/标签、创建人、可见性。
- 旧纯数字 Bangumi ID、旧回放、旧作品池无需迁移即可读取。

### 存储与安全

- 新增 `apps/server/src/manual-works.ts` 与 `manual-works-api.ts`：
  - `GET/POST /api/anime/manual`，`PUT/DELETE /api/anime/manual/:id`
  - `GET /api/anime/covers/:file`（opaque 文件名、immutable 缓存、`nosniff`、仅服务已登记文件）
- 上传校验：仅 JPG/PNG/WebP；magic bytes 与实际内容一致；≤4MB；64–6000px；剥离 JPEG EXIF/XMP/注释、PNG eXIf/tEXt/zTXt/iTXt/tIME、WebP EXIF/XMP。
- 手工作品默认私有；只有作者能编辑/删除；加入公开作品池后才进入公共目录。
- 删除为软删除：已复制的公开池、进行中房间快照与历史回放仍能解析必要快照；新作品池不能再选已删除作品。
- 作品池 `canUseWork` 服务端校验：不能引用他人的私有自建作品。
- 公开作品池保存时把其中的自建作品标记为 published；复制公开池保留作品可用性。

### 全链路

`手工上传 → 服务器存储 → 同一作品池 → 房间选池 → 候选池 → 5×5/6×6 组牌 → 封存 → 棋盘 → 猜牌 → 结算 → 回放`

- 封存卡片 `wordId = manual:<uuid>`；预览/图库不生成假的 Bangumi 链接。
- 房间配置对已存在社区池会解析服务器快照，即使原池后续修改/删除也不影响本局。
- 自定义/本地池通过 `animeCatalogFor(principal)` 只看到自己的自建作品与已公开作品。

### 搜索、分页与草稿

- 发现页显示「Bangumi 实时搜索 / 服务器缓存 / 我的自建作品」及真实总数；支持加载更多；无结果时给出链接导入与手动新增入口。
- 房间内作品池选择改为可搜索、可翻页的弹窗（公开/我的/收藏），不再只有首批 20 个。
- 「带回房间选择」按 `identityKey + roomId` 存储；保存配置成功后才清除。配置未保存时明确提示「尚未生效」。
- 草稿只在本地与服务端版本确有差异时恢复；身份切换不会读到他人草稿。

## 三、P2 UI

- 作品池广场：1100–1250px 自适应 2–3 列；封面横幅为主；无简介时不显示占位废话；本人/他人操作分级；删除、举报收进「···」；不能举报自己；普通用户看不到社区管理入口（管理员可通过已授权会话或 `?admin=1` 进入，服务端仍鉴权）。
- 个人资料：移除无数据「默契搭档」；「最近表现」改为「生涯概览」；称号按真实统计解锁并支持佩戴，用户名账户持久化到服务端，伪造未解锁称号会被服务端拒绝；切换账户与退出登录分离；身份备份/头像收进「身份与安全」；增加题库/作品池入口。
- 首页精选封面加载失败时自动移除并从列表补位，不再留下灰白空卡。
- 正文 14–15px、辅助 12–13px；桌面/手机、深浅色均无横向溢出。
- 所有操作保留加载/成功/失败/禁用原因反馈。

## 四、自动化与验收

已完成：

```bash
npm run typecheck
npm run test:rules          # 含 stability-round / manual-works / profile-title
npm run test:e2e:local      # 揭幕猜番 41/41
npm run build
npm run test:stability:local
npm run test:phase2:local
npm run test:bangumi:local
npm run test:concentrated:local
npm run test:lobby:local
npm run test:browser:local
npm run test:mixed:local
```

本轮新增浏览器验收：`scripts/browser-mixed.mjs`
- 4 个独立身份；真实上传 2 个自建作品 + Bangumi 候选，组成 50 部/50 系列混合池；
- 房间内应用混合作品池 → 5×5 组牌封存 → 棋盘封面 → 手动作品预览无假链接；
- 断线/重连后完成 **16 回合正常胜利**（非刺客捷径），双击不会重复翻牌；
- 结算与回放保留自建作品封面；
- 1440×900 与 390×844、深色/浅色截图。

截图（仓库内）：`docs/round4-screenshots/`。完整截图与 `report.json` 在本地 `artifacts/ui-acceptance-round4/`（已被 `.gitignore` 排除）。

## 五、部署前风险 / 未自动执行

- 未部署生产、未重启服务、未修改线上 `apps/server/data/`。
- 生产仍是单进程内存房间：重启会丢失进行中的房间与回放。
- 新增数据文件 `apps/server/data/manual-works.json` 与 `apps/server/data/anime-covers/` 需随部署目录保留（已加入 `.gitignore`，不提交）。
- 若线上已设置 `ENABLE_ANIME_COMMUNITY=1`，自建作品默认开启；可用 `ENABLE_ANIME_MANUAL=0` 单独关闭写入口。
- 手工封面的访问是「不可猜测文件名 + 作品池可见性」能力式访问；公开池分享后封面可被同池使用者加载。后续若要求更严格，可加短期签名 URL。
