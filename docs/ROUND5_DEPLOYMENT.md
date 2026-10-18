# Round 5 生产部署记录（2026-10-18）

## 结论

- 生产已从 `0c54201`（运行构建 `c61ca1d`）升级到 Round 5 分支 `53fad47`。
- 分支：`codex/cipai-round5-stability-anonymous-draft`
- 部署时间：2026-10-18 04:23:17 CST（`2026-10-17T20:23:17Z`）
- 备份：`/opt/codenames-backups/round5-53fad47/`（data、server-dist、web-dist、package 文件、ROLLBACK.txt）
- 部署前活跃房间：0；重启清空内存房间（本次无真实房间损失）。

## 执行步骤

1. 只读检查生产 HEAD、dirty 状态、systemd 服务、活跃房间、数据目录。
2. 备份生产数据与旧构建到 `/opt/codenames-backups/round5-53fad47/`。
3. 从隔离开发目录 fetch Round 5 分支并 checkout（未使用 reset/clean）。
4. `npm ci`：安装新增原生依赖 `sharp 0.35.5`（Linux x64 预编译）。
5. `npm run build`（shared/server/web）。
6. `systemctl restart codenames`。
7. 生产只读与真实多人匿名组牌验收。

未修改 systemd 配置；Round 4 的 drop-in 继续生效：
`MANUAL_WORK_STORE_FILE=/opt/codenames-acg/apps/server/data/manual-works.json`
`ANIME_COVER_DIR=/opt/codenames-acg/apps/server/data/anime-covers`
`ENABLE_ANIME_MANUAL=1`
未设置任何测试变量（`SIMULATE_CREATE_FAILURE_AFTER`、短 `DISCONNECT_KICK_DELAY_MS` 均不存在）。

## 生产验证

```text
systemctl is-active codenames            -> active
GET /health                              -> {"ok":true}
GET /api/features                        -> {"animeCommunity":true}
GET /api/anime/catalog                   -> 1846 works / 132 pools
GET /api/anime/manual（无身份）           -> 401
POST /api/anime/manual {}（无效）         -> 400，不产生作品
GET /                                    -> 200，assets/index-CxhFVRMe.js + index-BVfTZn33.css
```

真实生产浏览器验收（Chromium，4 名玩家 + 1 名旁观者）：
- 创建动画房间、入座、设置 5×5 + 季度池、双队长 ready；
- 红/蓝队长各加入一张普通手选，队员与旁观者实时看到中性 2 部；
- 非队长 `nextPlan` 无 `captainView`/claims/protectedUntil；
- 手机「实时组牌」页签与桌面公共只读面板正常；
- 1440×900、390×844 深/浅色截图，无 pageerror、无横向溢出；
- 验收结束所有席位退出，活跃房间回到 0。

截图（生产，gitignored）：`artifacts/deploy-round5/`
- `01-anonymous-desktop-dark.png`
- `02-anonymous-desktop-light.png`
- `03-anonymous-mobile-dark.png`
- `04-anonymous-mobile-light.png`

## 回滚

```bash
cd /opt/codenames-acg
git checkout 0c54201
npm ci
npm run build
systemctl restart codenames
```

数据回滚（仅必要时）：

```bash
systemctl stop codenames
cp -a /opt/codenames-backups/round5-53fad47/data/. /opt/codenames-acg/apps/server/data/
systemctl start codenames
```

## 部署后注意

- `sharp` 为新增原生依赖；后续部署必须执行 `npm ci` 或 `npm install`，不要只覆盖 dist。
- 自建作品封面采用历史保留策略，`apps/server/data/anime-covers/` 会随修改累积；需按磁盘容量定期人工归档。
- 匿名组牌只隐藏操作归属，队长身份仍按既有界面公开。
- 单进程内存房间：任何重启都会丢失进行中的房间与回放。
