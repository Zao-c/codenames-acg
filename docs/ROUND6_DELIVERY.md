# 词牌结社 Round 6 公开验收摘要

公开分支 `codex/cipai-round6`，应用提交 `76105124e65bc73fcef9594844eed75715dd97f4`。应用源文件与完成验收的本地版本逐字节一致，文件哈希与 14 项检查见 [evidence.json](round6/evidence.json)。

## 1. 交付边界

本轮按现有 Round 5 功能分支开发，保留成熟组牌交互与业务规则。生产现场核查、房间信息、数据备份和维护记录只保留在本地完整交付中，不纳入此公开分支或历史。线上发布需独立满足维护条件；本摘要不表示已经重启生产。

## 2. 本轮范围与状态

| 事项 | 结果 |
|---|---|
| S1 失效房间入口 | 已完成：导航仅信任服务端确认的当前房间；按 roomId 清理当前/恢复记录；跨标签通知，短暂断线保留恢复资格。 |
| 同账号 A/B 标签 | 已完成：每个标签的活跃会话优先于共享的最后会话；A 离线时被解散，恢复后清理 A 界面并保留 B。离开、导航、建房、回前台同步同样按所属标签处理。 |
| S2 旁观入座/候补 | 已完成：开放准备页直接入座；锁定组牌/正式对局排队或取消；满席说明；复用服务端权限，不改规则。 |
| S3 Round 5 | 已有并复验：动作请求锁、迟到错误隔离、队长保席、建房失败保留旧房、封面解码/历史、409、分页、匿名视图。 |
| 组牌布局 | 已完成：中性公共已选横条位于候选池上方，可折叠横向滚动；队长控制台桌面 360px、窄桌面 340px，两列已选；普通成员不渲染队长操作台。 |
| 原拖拽交互 | 原样保留：`DraftTile.tsx`、`AnimePlay.tsx`、服务端与共享规则无改动；鼠标领取/撤回/替换、鬼影/高亮、350ms 长按、滚动、手机 dock、预览与干扰确认均复验。 |
| 大厅/身份/主题 | 已完成：成员展示、我的席位、队长管理、随机分队分离；开局主操作首屏可达；红蓝身份、双方同时组牌、行动/等待/旁观状态和提示区阵营配色；深浅色和手机单列。 |
| 封面比例 | 已评估并保留当前默认。[对照报告](ROUND6_BOARD_EVALUATION.md)：桌面 6×6 当前 429px，4:3 为 650px，1:1 为 854px。详情仍 contain，确认/缩放/平移/预判保留。 |
| 品牌 | 已完成：原创双牌/连想星 SVG，导航、深浅 favicon、单色、应用图标及首页小型静态装饰；无第三方角色、壁纸、字体或新增依赖。 |
| 12 人扩容 | 延期：MAX_PLAYERS 保持 8；12 真实客户端（8 玩家 + 4 旁观）视觉压力通过。 |

## 3. 自动化检查

`npm ci` PASS（44s，锁文件未修改）。14 项最终有效检查如下；逐项日志与 JSON 位于 `output/playwright/round6/tests/`。

| 命令 | 结果 | 耗时 |
|---|---|---:|
| `npm run typecheck` | PASS | 9.14s |
| `npm run test:rules` | PASS | 50.44s |
| `npm run test:e2e:local` | PASS | 63.81s |
| `npm run build` | PASS | 13.60s |
| `npm run test:round5:local` | PASS | 46.65s |
| `npm run test:stability:local` | PASS | 62.26s |
| `npm run test:mixed:local` | PASS | 73.93s |
| `npm run test:lobby:local` | PASS | 37.58s |
| `npm run test:browser:local` | PASS | 89.48s |
| `npm run test:phase2:local` | PASS | 35.92s |
| `npm run test:bangumi:local` | PASS | 124.83s |
| `npm run test:concentrated:local` | PASS | 155.44s |
| `npm run test:round6:local` | PASS | 355.86s |
| `npm run test:round6:roles:local` | PASS | 28.77s |

所有服务使用独立本地端口与临时 JSON/图片目录，未访问生产业务数据。新增浏览器套件使用 3102/5267、3112/5277；其它既有套件保留各自端口。空临时用户文件的初次 fallback 日志属于初始化路径。

完整体验：4 玩家 + 1 旁观完成 5×5（16 次确认猜牌）、6×6（24 次）连续正常胜利，中途断线恢复；经典连续对局、混合作品池、回放、私人关联板独立复验；揭幕猜番 E2E 41/41。

拖放/隐私：真实鼠标 take、回候选池 release、撤回区、replace 取消/确认；真实 CDP touch 长按与短滑动；10 秒保护；完整 180 秒时钟的末 20 秒抢夺/替换拒绝并保留旧牌；干扰确认/更换；0/1/6/12 公共集合、折叠/筛选。非队长网络没有 captainView、claims、protectedUntil、私人书签或干扰来源；抢夺不改变公开集合。

同账号专项：A 标签失联、B 标签另建房间、第三客户端解散 A；A 恢复取得失效错误后清理自己的界面，两标签读取的有效 B 会话仍在。旁观者 draft/playing 排队与取消也经过真实服务端往返。

早期回归发现的身份条 Grid 顺序、手机 6×6 遮挡、准备页开局按钮离开首屏和提示条紫色背景已修正并复验。失败记录保留于 `tests/*.previous-*`、`attempts/`。旧大厅测试补采 Socket.IO polling 首包；混合对局脚本遵守原有 3 次线索/10 秒限流。没有放宽生产规则或用静态 HTML 代替 React 应用。

## 4. 截图证据

真实桌面 1440×900、手机 390×844、平板 900×1024，深浅主题与红蓝队长/队员/旁观者；before 为布局变更前，after 为主验收及 5×5/6×6 三比例对照，formal 为最终身份、提示条、候补与手机控制台。各 report.json 记录浏览器、视口、主题、URL 和应用提交。

- [桌面组牌](round6/screenshots/desktop-draft-light.png)
- [手机队长操作台](round6/screenshots/mobile-captain-console-dark.png)
- 完整本地证据：`output/playwright/round6/`。
- 截图均来自隔离环境的临时测试房间；原始拍摄元数据保留在本地完整证据。

## 5. 品牌资源

[原创说明与尺寸](ROUND6_BRAND.md)。PNG 由同一原创 SVG 通过现有 sharp 生成；没有第三方图片或嵌入字体。共 10,893 B 静态品牌资源。

| 文件 | 大小 |
|---|---:|
| `cipai-16.png` | 600 B |
| `cipai-32.png` | 1,174 B |
| `cipai-app-180.png` | 6,836 B |
| `cipai-icon.svg` | 683 B |
| `cipai-lockup.svg` | 730 B |
| `cipai-mono.svg` | 429 B |
| `cipai-spark.svg` | 441 B |

## 6. 可审查提交

```text
8dae7b2 fix: isolate room lifecycle per tab and align spectator seating
d6506ca feat: add original linked-card brand and adaptive icons
7610512 feat: refine draft layout, identity and lobby tools while preserving gestures
```

程序、测试、原创品牌和测试房间截图可公开评审。PR 使用既有 Round 5 分支为 base，避免旧 main 的历史差异混入本轮。

## 7. 后续范围

人数保持 8；12 人扩容需另行验证每队上限、入座、候补、接任、秘密暴露和手机长名单。运行依赖仍有继承的审计告警，本轮锁文件未修改，需独立升级和适用性评估。原有主包体积提示也留待后续性能优化。
