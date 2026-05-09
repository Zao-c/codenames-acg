# acg_codenames

一个面向 ACG 玩家和朋友联机的在线《行动代号》桌游。玩家可以创建房间、分队、担任队长或行动员，用内置词库、个人题库或公共题库开局。

项目当前重点是“小圈子快速开房一起玩”：前端负责房间界面和题库管理，后端负责实时同步、权限判定、房间状态和用户题库。

---

## 当前功能

- 实时多人房间：创建房间、复制邀请链接、加入房间、重连恢复。
- 队伍与角色：红队/蓝队、队长/行动员、旁观者。
- 服务端权威判定：开局、线索、猜词、回合切换、房主操作都由后端验证。
- 房主控制：返回大厅、转让房主、解散房间。
- 房间大厅：区分“准备中可加入”“进行中可旁观”“已结束”。
- 题库系统：内置题库、我的题库、公共题库。
- 候选题库审核：可导入更复杂的 ACG 词条 JSON，筛选后导出为可玩的词库。
- AI 提取 Prompt：内置从直播录播、游戏文本、百科和台词中提取候选词条的通用 Prompt。
- 本地调试：localhost 下支持 solo debug，方便一个人跑完整流程。

---

## 游戏规则

行动代号是一款队伍推理和词语联想游戏。玩家分成红蓝两队，每队包含一名队长和若干行动员。

队长能看到棋盘上每张词卡背后的身份，并给出一个线索和数量；行动员只能看到公开词语，需要根据线索猜出己方词卡。猜中己方词卡可以继续推进，猜到对方、中立或刺客会带来风险。

默认棋盘为 `5 x 5` 共 25 张词卡。

| 身份 | 说明 |
|---|---|
| 红队词 | 红队需要找出的目标 |
| 蓝队词 | 蓝队需要找出的目标 |
| 中立词 | 猜到后通常会结束当前回合 |
| 刺客词 | 猜到后立即导致当前队伍失败 |

基本流程：

1. 房主创建房间并选择题库。
2. 玩家加入房间，分配红蓝队和角色。
3. 房主开始游戏。
4. 当前队伍队长提交线索。
5. 当前队伍行动员根据线索猜词。
6. 回合结束后切换队伍。
7. 找完己方全部词卡或触发刺客后结算。

---

## 题库系统

### 内置题库

项目自带基础 ACG 词库，开房时可以直接选择。

### 我的题库

登录用户名后，可以维护个人题库：

- 上传轻量题库：`string[]` 或 `{ name, entries: string[] }`
- 上传候选题库：包含 `display`、`aliases`、`type`、`franchise`、`difficulty`、`spoilerRisk` 等字段
- 在审核界面筛选、批量通过、导出为可玩的个人题库
- 将个人题库设为公共，或从公共改回私有

### 公共题库

公共题库会出现在首页“公共题库”区域，其他玩家可以直接用它创建房间。

公共题库使用 `发布者 + 题库 ID` 作为唯一身份，因此不同用户即使上传同名或同 ID 的本地题库，也不会互相覆盖。

### AI 提取 Prompt

用于生成候选题库的 Prompt 放在：

- [docs/prompts/acg-word-pack-extraction.md](docs/prompts/acg-word-pack-extraction.md)

推荐流程是先让 AI 生成候选 JSON，再用第二轮审稿 Prompt 做去重、合并和筛选，最后导入游戏里的候选题库审核界面。

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

## 本地开发

### 准备

- Node.js 20+
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

```bash
npm run typecheck
npm run test:e2e
npm run build
```

完整检查：

```bash
npm run verify
```

浏览器冒烟测试需要先启动前后端：

```bash
npm run test:browser
```

截图和报告会写入 `artifacts/browser-smoke/`。

---

## 服务器部署

一台轻量服务器即可部署前后端。推荐先用 Nginx 托管前端静态文件，并把 `/api/` 和 `/socket.io/` 反向代理到 Node 后端。

### 构建

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

### 生产环境变量示例

```bash
export PORT=3001
export CLIENT_ORIGIN=http://服务器公网IP
export VITE_SERVER_URL=http://服务器公网IP
export USER_STORE_FILE=/data/acg_codenames/users.json
export ENABLE_DEBUG_TOOLS=0
```

如需更稳定的房间状态或多进程部署，再接入 Redis：

```bash
export REDIS_URL=redis://127.0.0.1:6379
```

### 启动后端

```bash
npm run start -w @acg-codenames/server
```

也可以直接运行编译后的入口：

```bash
node apps/server/dist/apps/server/src/index.js
```

### Nginx 示例

```nginx
server {
    listen 80;
    server_name _;

    root /var/www/acg_codenames/dist;
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

生产环境重点：

- `USER_STORE_FILE` 指向持久化磁盘。
- 不要把 `apps/server/data/*.json` 提交到仓库。
- Nginx 必须正确代理 `/socket.io/` 的 WebSocket upgrade。
- 前端构建时的 `VITE_SERVER_URL` 要指向玩家实际访问的公网地址。

---

## 目录结构

```text
acg_codenames/
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
├── docs/prompts/               # AI 题库提取 Prompt
├── packages/shared/            # 前后端共享类型和规则
├── scripts/browser-smoke.mjs   # 浏览器冒烟测试
├── 代号/                       # 题库源文件
├── package.json
└── README.md
```

---

## 注意事项

- 当前用户数据是本地 JSON 文件，适合个人服务器和早期测试；正式运营建议迁移到数据库。
- `dist/`、日志、`artifacts/`、`node_modules/` 和运行时数据都已被 git 忽略。
- 进行中的房间只能旁观，不能直接作为玩家加入。
- 房主解散房间会广播 `room_closed`，客户端会清空当前房间并回到首页。
- 本地 debug 工具只适合开发测试，正式环境建议设置 `ENABLE_DEBUG_TOOLS=0`。
