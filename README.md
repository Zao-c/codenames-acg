# 行动代号 ACG Codenames

一个面向朋友联机的在线《行动代号》同人项目。玩家可以创建房间、分队、担任队长或行动员，用内置 ACG 词库、个人题库或公共题库开局。

> 选一套题库，邀请朋友进房，队长给线索，行动员猜词。服务端统一判定房间状态和玩家权限，适合本地开黑，也为后续云服务器部署预留了实时联机能力。

---

## 相关链接

| | |
|---|---|
| GitHub 仓库 | https://github.com/Zao-c/codenames-acg |
| 本地前端 | http://localhost:5173 |
| 本地后端 | http://localhost:3001 |

---

## 游戏规则

### 游戏概述

行动代号是一款**队伍推理 + 词语联想**游戏。玩家分成红蓝两队，每队包含一名队长和若干行动员。

队长能看到棋盘上每张词卡背后的身份，并给出一个线索和数量；行动员只能看到公开词语，需要根据线索猜出己方词卡。猜中己方词卡可以继续推进，猜到对方、中立或刺客会带来风险。

### 棋盘与身份

默认棋盘为 `5 x 5` 共 25 张词卡。每张词卡在服务端开局时分配一种身份：

| 身份 | 说明 |
|---|---|
| 红队词 | 红队需要找出的目标 |
| 蓝队词 | 蓝队需要找出的目标 |
| 中立词 | 猜到后通常会结束当前回合 |
| 刺客词 | 猜到后立即导致当前队伍失败 |

队长视角可以看到身份颜色，行动员和旁观者不能看到隐藏身份。

### 队伍与角色

- 房间至少需要红蓝两队都有人。
- 每队需要一名队长。
- 队长负责提交线索。
- 行动员负责点击词卡进行猜测。
- 旁观者可以进入进行中的房间观看，但不能参与操作。

### 回合流程

1. 房主创建房间并选择题库。
2. 玩家加入房间，分配红蓝队和队长/行动员角色。
3. 房主开始游戏。
4. 当前队伍队长提交线索。
5. 当前队伍行动员根据线索猜词。
6. 回合结束后切换队伍。
7. 任一队找完己方全部词卡，或触发刺客结算，游戏结束。

### 房主权限

房主是房间管理者，当前支持：

- 开始游戏。
- 返回大厅，重置当前对局并保留房间成员。
- 转让房主给其他真实玩家。
- 解散房间，让所有客户端回到首页。

这些操作都由服务端判定权限，非房主请求会被拒绝。

---

## 题库系统

### AI 提取 Prompt

仓库内置了一份通用 Prompt，用来从直播录播、游戏文本、动漫百科、动漫台词或社区讨论中提取适合桌游的 ACG 词牌候选：

- [docs/prompts/acg-word-pack-extraction.md](docs/prompts/acg-word-pack-extraction.md)

推荐流程是先让 AI 生成候选 JSON，再用第二轮审稿 Prompt 做去重、合并和筛选，最后导入游戏里的候选题库审核界面。

### 内置题库

项目自带基础 ACG 词库，开房时可以直接选择。

### 我的题库

登录用户名后，可以在首页维护个人题库：

- 上传轻量题库：`string[]` 或 `{ name, entries: string[] }`
- 上传候选题库：包含 `display`、`aliases`、`type`、`franchise`、`difficulty`、`spoilerRisk` 等字段
- 在候选题库审核界面筛选、批量通过、导出为可玩的个人题库
- 将个人题库设为公共，或从公共改回私有

### 公共题库

公共题库会出现在首页“公共题库”区域，其他玩家可以直接用它创建房间。

公共题库使用 `发布者 + 题库 ID` 作为唯一身份，因此两个用户即使上传同名或同 ID 的本地题库，也不会互相覆盖。

---

## 房间大厅

首页大厅会展示房间状态：

| 状态 | 含义 | 入口 |
|---|---|---|
| 准备中 | 房间还在组队和选角色 | 加入战局 |
| 进行中 | 对局已经开始 | 旁观 |
| 已结束 | 对局结束或房间不可加入 | 不可加入 |

进行中的房间优先显示“旁观”入口，而不是把“加入”按钮简单禁用。旁观者队列会保留到下一轮大厅阶段。

---

## 功能特性

- 实时多人房间：Socket.IO 同步房间、队伍、棋盘和回合状态。
- 服务端权威判定：开始游戏、提交线索、猜词、换回合、房主操作都由服务端验证。
- 用户题库：支持命名账号、头像、个人题库和公共题库。
- 候选题库审核：适合从更大的 ACG 词条 JSON 中筛出真正可玩的词。
- 旁观与下一轮队列：进行中房间可以旁观，保留后续加入能力。
- 房主控制：返回大厅、转让房主、解散房间。
- 本地单人调试：localhost 下支持 debug fill，方便一个人跑完整流程。
- 响应式前端：桌面和移动端都能完成核心操作。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 · TypeScript · Vite |
| 后端 | Node.js · Express · Socket.IO |
| 共享包 | TypeScript 类型、常量、视图裁剪逻辑 |
| 房间状态 | Redis 可选；本地开发可用内存存储 |
| 用户数据 | 本地 JSON 文件存储，路径可配置 |
| 测试 | TypeScript typecheck · Socket E2E · Playwright smoke |

---

## 本地开发启动

### 需要准备

- Node.js 20+（Node 18+ 大概率也能运行，但建议使用新版 LTS）
- npm
- Git

### 安装依赖

```bash
npm install
```

### 启动后端

```bash
npm run dev:server
```

默认监听：`http://localhost:3001`

### 启动前端

```bash
npm run dev:web
```

默认访问：`http://localhost:5173`

### 局域网访问

如果想让同一 Wi-Fi 下的手机或另一台电脑访问前端：

```bash
npm run dev:web:host
```

同时把后端 `CLIENT_ORIGIN` 配成实际前端地址，前端 `VITE_SERVER_URL` 配成后端局域网地址。

---

## 环境变量

### 后端 `apps/server/.env`

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3001` | 后端监听端口 |
| `CLIENT_ORIGIN` | `http://localhost:5173,http://localhost:4173` | 允许跨域的前端地址，多个地址用逗号分隔 |
| `REDIS_URL` | 空 | Redis 地址；配置后可用于房间状态 |
| `USE_MEMORY_STORE` | `0` | 设为 `1` 时强制使用内存房间存储 |
| `ENABLE_DEBUG_TOOLS` | `1` | 设为 `0` 可关闭本地调试工具 |
| `USER_STORE_FILE` | `apps/server/data/users.json` | 用户资料和题库 JSON 文件路径 |

### 前端 `apps/web/.env`

| 变量 | 默认值 | 说明 |
|---|---|---|
| `VITE_SERVER_URL` | `http://localhost:3001` | 前端连接的后端地址 |

---

## 验证

### 类型检查

```bash
npm run typecheck
```

### 服务端 E2E

```bash
npm run test:e2e
```

覆盖重点：

- 命名用户与题库持久化
- 公共题库发布、取消发布、列表展示
- 使用公共题库创建房间
- 创建房间、重连、非法开局拦截
- 队长视角隐藏身份和目标反应
- 本地 solo debug 流程
- 房主转让、旧房主失权、新房主返回大厅和解散房间
- `room_closed` 广播

### 完整检查

```bash
npm run verify
```

会依次运行：

1. `npm run typecheck`
2. `npm run test:e2e`
3. `npm run build`

### 浏览器冒烟测试

先启动前后端，再运行：

```bash
npm run test:browser
```

截图和报告会写入 `artifacts/browser-smoke/`。

---

## 服务器部署

### 直接部署

**1. 构建项目**

```bash
npm install
npm run build
```

构建产物：

```text
apps/web/dist/                 # 前端静态文件
apps/server/dist/              # 后端编译产物
packages/shared/dist/          # 共享包编译产物
```

**2. 准备生产环境变量**

示例：

```bash
export PORT=3001
export CLIENT_ORIGIN=https://你的域名
export VITE_SERVER_URL=https://你的域名
export USER_STORE_FILE=/data/codenames-acg/users.json
```

如需多进程或多机器部署，建议接入 Redis：

```bash
export REDIS_URL=redis://127.0.0.1:6379
```

**3. 启动后端**

```bash
npm run start -w @acg-codenames/server
```

也可以直接运行编译后的入口：

```bash
node apps/server/dist/apps/server/src/index.js
```

**4. 配置 Nginx**

```nginx
server {
    listen 80;
    server_name 你的域名;

    root /var/www/codenames-acg/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

**5. 开启 HTTPS**

```bash
certbot --nginx -d 你的域名
```

生产环境重点：

- `USER_STORE_FILE` 指向持久化磁盘。
- 如果有多台后端或需要更稳定的房间状态，配置 Redis。
- Nginx 必须正确代理 `/socket.io/` 的 WebSocket upgrade。
- 前端构建时的 `VITE_SERVER_URL` 要指向公网后端地址。

---

## 目录结构

```text
007games/
├── apps/
│   ├── server/                 # Express + Socket.IO 后端
│   │   ├── src/
│   │   │   ├── env.ts          # 环境变量读取
│   │   │   ├── game.ts         # 房间和对局引擎
│   │   │   ├── index.ts        # HTTP 与 Socket 入口
│   │   │   ├── store.ts        # 房间存储
│   │   │   └── user-store.ts   # 用户和题库存储
│   │   └── test/e2e.ts         # Socket E2E
│   └── web/                    # React 前端
│       └── src/
│           ├── App.tsx         # 主界面和房间流程
│           ├── lib/api.ts      # HTTP API 客户端
│           ├── lib/socket.ts   # Socket 客户端
│           └── lib/            # 题库审核、音效、本地存储等
├── packages/shared/            # 前后端共享类型和规则
├── scripts/browser-smoke.mjs   # 浏览器冒烟测试
├── 代号/                       # 题库源文件
├── package.json
└── README.md
```

---

## 注意事项

- 当前用户数据是本地 JSON 文件，适合个人服务器和早期测试；多人正式运营建议迁移到数据库。
- `apps/server/data/*.json` 是运行时数据，已被 git 忽略。
- `dist/`、日志、`artifacts/`、`node_modules/` 都不会提交到仓库。
- 进行中的房间只能旁观，不能直接作为玩家加入。
- 房主解散房间会广播 `room_closed`，客户端会清空当前房间并回到首页。
- 本地 debug 工具只适合开发测试，正式环境可通过 `ENABLE_DEBUG_TOOLS=0` 关闭。

---

*组队、给线索、别点刺客。*
