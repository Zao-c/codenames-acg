# 首页与准备大厅 UI v2 本地交付

日期：2026-10-16。范围以用户本轮明确指令为准：只改首页公开大厅、词牌房间准备大厅；附件中的组牌台重构及已选缩略卡拖回需求不在本轮范围。服务器部署与 pull 由用户指定的其他 AI 执行，本 Agent 仅开发、测试、commit、push。

## 基线核对

- GitHub PR #7、远程 `codex/cipai-phase2-community`、本地基线均为 `34c85ef47f15b6859b971f12913926abe7713e75`。
- 本轮按用户要求，只读 SSH 核对 `/opt/codenames-acg`：HEAD 和 release.json 均为上述提交，`codenames.service` 为 active。release 标记三个第二批开关开启；未读取凭证或用户数据，未变更服务器。
- 本轮实施分支：`codex/cipai-lobby-ui-v2`。完整继承 G0–G5、既有 UI、第二批私密分析与社区能力，没有从旧 main 覆盖。

## 交付行为

- 首页按认可原型重组为品牌介绍、统一建房弹窗、紧凑房号栏、公开房间卡片。桌面三列均分，平板两列，手机单列；全部/可加入/进行中筛选、可加入准备房间优先，删除系统事件文本。
- 经典、动画、揭幕三个建房选择使用原 Socket.IO 能力；揭幕进入独立准备流程。保留明确标注的高级建房入口，以及文字题库、图库等原功能。
- `PreparationLobby` 替代配置/成员旧面板的叠加：本局摘要、队伍与成员、聊天、唯一下一步。自己的队伍/身份在本人行调整；队长在同一成员区指定。设置只在一个弹窗编辑，房主管理收进标题右侧菜单。
- 计分显示胜场制/积分制；旧 gamble 数据仍被服务端接受，未主动更改时保持旧值。经典 5×5/7×7/9×9、内置/个人/公共/上传文字题库、计时与翻牌设置保留；动画季度/私人/社区版本选池保留。进阶设置随同一次配置原子保存，取消弹窗不提交暂存值。
- 聊天保留真实消息、输入、发送；删除快捷语入口，弹幕偏好放入快捷设置。
- 下一步根据真实 planning/guide/draft/sealed/countdown/playing 状态显示；planning 不显示取消准备。队长预览无正式倒计时，双方确认后服务端才启动 180 秒；封存后才允许五秒开局。正式组牌继续使用原工作区，正式对局与结算布局未重构。
- 私密复盘入口仍可在返回准备大厅后访问；不会把私密图谱、书签或选牌信息加入公开房间卡片。

## 服务端与协议

- `randomize_teams` 新增可选 `mode: 'all' | 'keep-captains'`，旧客户端省略时沿用全员随机。
- 所有随机分配由服务端房间锁执行。4 人起、奇偶人数均衡、保留两队指定队长、可重复重抽；非房主、组牌、封存、开局倒计时与正式对局均不能重分队。
- 准备阶段选队、选身份、指定/交接队长、随机分队与返回大厅会同步实际角色和动画计划。对局中的未来队长任命仍不改当前角色。重分队清空旧确认，防止旧的就绪状态启动新阵容。
- 首次指定队长支持尚不存在 nextPlan 的房间；已有计划继续检查快照版本。关闭动画开关时经典指定队长仍正常。
- 公开摘要仅增加玩法、作品池名称与准备中的真实棋盘尺寸；计划公开视图增加文字题库名称。新增配置字段带服务端校验；非法配置不部分落盘。
- Web/shared/server 必须同版本构建与发布，不能只替换 CSS。无依赖变更，无账号/图库/社区数据迁移，无新环境变量。

## 本地验收

| 命令 | 结果与重点 |
| --- | --- |
| `npm run typecheck` | 全工作区通过 |
| `npm run build` | shared/server/web 通过；Vite 保留单 JS 包超过 500 kB 的提示 |
| `npm run test:rules` | 全部通过；新增 4/5/8 人共 240 次重抽、固定队长、动画同步、阶段/权限锁、经典关闭动画开关、非法配置原子性 |
| `npm run test:e2e:local` | 原 Socket.IO 套件通过；揭幕猜番 41/41 |
| `npm run test:browser:local` | 旧浏览器验收 10/10：三局连续、重连、拖拽、触摸、预览不翻牌、隐私、回放 |
| `npm run test:phase2:local` | 第二批浏览器 4/4 组：社区、版本选池、图谱、预测、私密复盘与身份恢复 |
| `npm run test:lobby:local` | 新大厅浏览器 4/4 组：真实多客户端重复重抽、合并成员、配置/上传、三张真实房间、筛选、准备全阶段与首屏主操作 |

三个浏览器套件均零 pageerror。新大厅截图来自真实本地服务器和 Socket.IO 房间；只用测试参与者创建隔离房间，不在生产 UI 填写原型模拟状态。一次受限环境构建遇到 Windows realpath EPERM，切换允许访问工作区的执行环境后构建成功。

截图与报告（本地忽略产物）：

- `output/playwright/lobby-v2/07-home-desktop-dark.png`、`08-home-desktop-light.png`
- `output/playwright/lobby-v2/09-home-mobile-light.png`、`10-home-mobile-dark-360.png`
- `output/playwright/lobby-v2/01-preparation-desktop-dark.png`、`02-preparation-desktop-light.png`
- `output/playwright/lobby-v2/03-preparation-mobile-dark.png`、`04-members-mobile-dark.png`、`05-members-mobile-light.png`、`06-chat-mobile-light.png`
- `output/playwright/lobby-v2/11-sealed-desktop.png`、`report.json`

## 给部署 Agent

本版本尚未部署，服务器依旧是核对时的 `34c85ef`。按用户安排读取本分支最新提交后，沿用现有完整构建发布流程，保留磁盘账号、图库、社区池及原环境配置。服务仍为单进程内存房间/回放，重启会清空；部署前应检查实际房间并安排空房窗口。不得把本地测试成功记成生产验收成功。部署后重点验收两个页面、两种重复分队、动画队长同步、经典/动画/揭幕建房以及 guide→draft→sealed→playing。
