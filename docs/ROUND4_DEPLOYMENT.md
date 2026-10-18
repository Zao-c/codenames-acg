# Round 4 生产部署记录（2026-10-18）

## 结论

- 生产已从 `edd3072` 升级到 `c61ca1d`（分支 `codex/cipai-bangumi-free-pools`，PR #11）。
- 部署时间：2026-10-18 01:01:56 CST（`2026-10-17T17:01:56Z`）。
- 备份：`/opt/codenames-backups/round4-c61ca1d/`（data、resources、server-dist、web-dist、package 文件、ROLLBACK.txt）。
- 单进程内存房间在重启时全部清空（`memoryRoomsCleared: true`），已获用户明确部署授权。

## 部署步骤（本次实际执行）

1. 备份生产数据与构建产物到 `/opt/codenames-backups/round4-c61ca1d/`。
2. 增加 systemd drop-in（不读取/修改 `.env`）：
   `/etc/systemd/system/codenames.service.d/round4-manual-pools.conf`
   ```
   [Service]
   Environment=ENABLE_ANIME_MANUAL=1
   Environment=MANUAL_WORK_STORE_FILE=/opt/codenames-acg/apps/server/data/manual-works.json
   Environment=ANIME_COVER_DIR=/opt/codenames-acg/apps/server/data/anime-covers
   ```
   原因：服务工作目录是 `/opt/codenames-acg/apps/server`，默认相对路径会落到嵌套的 `apps/server/apps/server/data/`。
3. `systemctl daemon-reload`
4. `npm run build`（shared → server → web）
5. `systemctl restart codenames`

## 验证

服务端：
```text
systemctl is-active codenames            -> active
GET /health                              -> {"ok":true}
GET /api/features                        -> {"animeCommunity":true}
GET /api/anime/manual (无身份)           -> 401
POST /api/anime/manual {}                -> 400（未创建数据）
GET /api/anime/catalog                   -> 1846 works / 132 pools
GET /                                   -> 200 text/html
```

生产页面（Playwright，Chromium）：
- 首页、作品池广场、个人资料：1440×900 深/浅色
- 作品池广场、个人资料：390×844 深/浅色
- 真实 Socket：游客建房 → 第二名游客加入 → 大厅可见 → 双方离开后房间清理
- 无 pageerror、无横向溢出

截图（本地，gitignored）：`artifacts/deploy-round4/`
- `01-home-desktop-dark.png`
- `02-plaza-desktop-dark.png` / `03-plaza-desktop-light.png`
- `04-profile-desktop-dark.png` / `07-profile-desktop-light.png`
- `05-room-lobby-desktop-dark.png`
- `08-plaza-mobile-dark.png` / `09-plaza-mobile-light.png`
- `10-profile-mobile-light.png`

## 回滚

如需回滚到部署前版本：

```bash
cd /opt/codenames-acg
git checkout edd3072
npm run build
rm -f /etc/systemd/system/codenames.service.d/round4-manual-pools.conf
systemctl daemon-reload
systemctl restart codenames
```

数据回滚（会覆盖部署后写入的数据，慎用）：

```bash
systemctl stop codenames
cp -a /opt/codenames-backups/round4-c61ca1d/data/. /opt/codenames-acg/apps/server/data/
systemctl start codenames
```

## 部署后注意事项

- 新数据文件 `apps/server/data/manual-works.json` 在首次创建自建作品时生成；封面写入 `apps/server/data/anime-covers/`。
- 封面通过不经身份鉴权的 opaque 文件名访问，公开作品池分享后同池使用者可加载；如需更强控制，后续可改为短期签名 URL。
- 月度/季度清理脚本不要删除 `manual-works.json` 与 `anime-covers/`。
- 仍为单进程内存房间：重启会丢失进行中的房间与回放。
