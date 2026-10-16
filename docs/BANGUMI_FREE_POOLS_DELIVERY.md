# Bangumi 动画发现与自由组池：实施与交付

## 基线与授权

基于 PR #10 的完整分支 `7017438468671155d9c1a9004ad2c6c3ce896cb5` 创建唯一特性分支 `codex/cipai-bangumi-free-pools`。动工时 PR #10 仍 open，生产应用 `3b8263a`，没有从 main 覆盖功能。新材料包是计划与原型；其中演示用户、评分和 ID 未移植到生产。

用户本轮消息明确授权完整测试后统一部署一次，优先于附件中“先交付、不自动部署”的旧限制。正式发布仍须没有活跃玩家、备份完整、测试通过；服务仍为单进程内存房间和回放，不能重启续局。

## 优先处理的 P0

1. 用新增服务测试复现：已封存后队长离线，旧服务仍接受 `startGame`。现在在开局请求、倒计时结束和真正初始化棋盘三个边界检查在线队长及有资格猜牌的在线队员；检查失败取消倒计时、保留封存快照并给出中文原因。短暂离线不剥夺队长身份。
2. 房主可沿用已有 `plan_action transfer` 交接当前局给在线同队玩家。旧队长接触秘密标记继续生效，不能回来猜牌或重新接任。四人双交接使全部队员已接触密钥时，现在不会开成不可完成的局；既有测试增加未接触密钥的队员后继续验证正常开局和旧队长拒猜。
3. 旧 `forceEndGame` 确实取 `nextTeam(currentTeam)`，并记录胜场。现在 `force_end_game` 显式区分 `abort` 和 `surrender`，旧无 mode 请求安全解释为中止。房主中止无胜者，恢复本局开始时的累计积分，不记账号战绩、胜场、成就；本队认输按操作者实际队伍判对方胜，胜场制仅计房间对方一胜，积分制恢复本局初始积分，均不授予账号战绩或成就。由本队队长或房主认输，队长离线时队员可安全弃赛，不能自领密钥。
4. 中止和认输继续生成带结束原因的公共回放；历史 `forfeit` 及无结束原因的旧回放保留可读。干扰来源和私人意图仅正常完赛才开放既有私密复盘，不因提前结束公开。对局中直接返回准备也先经过无胜者中止路径，避免保留当前局积分。

## 统一目录与 API

沿用 `AnimePoolsPage`、`AnimePoolStore`、`animeCatalog()` 以及社区池 ID/revision 选用流程。没有第二套 Bangumi 图库。

- `BangumiAdapter` 仅请求固定 `https://api.bgm.tv/v0`；输入 URL 只解析官方 subject ID，不按原 URL fetch。校验动画主类型 2、排除成人条目，媒介使用真实 platform，缺失显示“未知”，不把动画主类型猜成 TV。
- 规范 User-Agent、8 秒单次超时、2 MB 响应限制、禁止跳转、全局串行间隔、同请求合并、搜索两分钟缓存和条目一天 TTL，429/5xx/网络错误退避。无 token/OAuth。断网时搜索明确回退服务器缓存；已有池和组牌不依赖上游在线。
- 默认静态资源 + `ANIME_IMPORT_FILE` 增量覆盖层共同组成唯一目录；动态池存储跟随同一目录引用更新，导入后立即可保存并用于 5×5/6×6。原子临时文件重命名，同时写最新镜像 `.bak`；损坏时从镜像恢复，不在启动时被静态目录覆盖。
- 新元数据为可选字段：tags、rating、ratingCount、popularity、source、updatedAt、detailFetchedAt、seriesSource、seriesLinks。未知评分和人数不是 0，旧池 JSON 无需迁移。
- 系列延续旧人工 overrides；新增 ID 可在 `anime-series-overrides.json` 的 `subjectIds` 中维护人工映射。条目详情导入读取官方前传/续集/番外/总集关联，与已知目录及增量条目合并；没有已知关联时保留独立条目 ID 并明确标注来源，不以标题相似度擅自合并。
- 房间配置从统一目录生成独立 pool/candidate 快照并保存 sourcePool revision，外部编辑和元数据刷新不修改现有预览、组牌、棋盘或回放。

| 站内接口 | 用途与上游 |
| --- | --- |
| `POST /api/anime/discovery/search` | `AnimeDiscoveryQuery` → 官方 `POST /v0/search/subjects?limit=24&offset=…`，或缓存筛选 |
| `POST /api/anime/discovery/import` | `{input: ID或官方链接}` → `GET /v0/subjects/:id` 及可选官方关联，持久化后返回 AnimeWork |
| `GET /api/anime/catalog` | 原统一目录接口，现包含增量条目，使用 no-store 防止刚导入条目在另一工作区缺失 |
| `/api/anime-pools` | 保留原创建/读取/版本更新/私有 ACL/公开复制/收藏/举报/管理接口 |
| `plan_action configure` | 保留原社区池 ID + revision 服务器解析和候选/系列配额校验 |

新发现接口需要有效设备私密凭证，每 IP 每分钟 30 个请求，客户端不能提交 AnimeWork 对象绕过目录。官方搜索为实验性接口：标签“且”传上游，标签“或”、媒介、跨年季度及最新排序在本页 24 条真实元数据内严格执行。UI 明确该范围和“加载更多”，不声称对 Bangumi 全库完成客户端细筛。年份、评分、人数等可靠条件同时传官方接口；不开放未经验证的排除标签。

官方依据：[公开 API 与 User-Agent](https://github.com/bangumi/api)、[当前 schema](https://github.com/bangumi/server/blob/master/openapi/v0.yaml)。真实联调已确认空关键词组合筛选可用、结果包含 platform/rating/total；不使用假榜单。生产网络需沿用既有环境代理；Node 22.21+ 支持 `NODE_USE_ENV_PROXY=1`，代理配置只保留在服务器，不记录其地址或凭证。

## UI

以新增 HTML 为主结构：桌面 220px 筛选 / 四列真实海报 / 280px 已选工作区；手机两列与发现、筛选、已选页签。预览与加入分离，批量加入/移除本页、只看已选、撤销选牌、计数与缺口、私人草稿/公开发布、冲突重读、继续编辑、分享及用于当前房间/创建动画房间均连接原接口。临时未保存编辑按私密凭证隔离保存于本机，正式保存使用服务器持久化和 revision。

## 验证与发布状态

确定性上游仅通过测试 runner 的 Node preload 注入，生产代码没有 fixture 开关。真实 API 冒烟和真实数据截图单独执行，不将 mock 测试记作线上验证。

已部署：2026-10-16 21:01（北京时间；备份 20:58 起）部署应用提交 `5b8af4c`（分支 `codex/cipai-bangumi-free-pools`，[PR #11](https://github.com/Zao-c/codenames-acg/pull/11)），上一版 `3b8263a`。完整备份 `/opt/codenames-backups/bangumi-free-pools-5b8af4c/`（源码、构建日志、systemd 与 env 前后快照、重启守卫检查、持久数据哈希 `anime-pools.json` a5a109e1…、`users.json` 4aa7af58…），目录与产物仅 root 可访问；构建产物 `index-DBdD6ePJ.js` 545.92 kB / `index-BlotwwB5.css` 132.65 kB。重启前 `/rooms` 为空，未中断对局。

线上真实上游验收（无 fixture，证据在 `artifacts/prod-acceptance-5b8af4c/bangumi-live-prod/`）：真实筛选查询与评分/人数元数据、官方未缓存条目 302 导入后服务端保存与第二设备凭证编辑、1440×900 与 390×844 暗亮、筛选/已选/预览可达、无横向溢出与页面错误，`passed:true`。后续集中修复轮基于该提交继续，见 [集中修复轮交付](CONCENTRATED_STABILITY_UX_DELIVERY.md)。

回滚必须保留新增导入目录和社区池。`scripts/export-anime-rollback.mjs` 可把当前静态目录与导入覆盖层合成兼容旧应用的静态 catalog；回退到 PR #10 前先导出、checkout 旧提交后替换该静态 catalog，再恢复旧构建产物。禁止删除旧应用不认识的作品池或覆盖部署后产生的磁盘数据。该兼容导出和旧版池校验在服务测试中验证。
