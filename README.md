# 词牌结社 · ACG Codenames

一个面向 ACG 玩家和朋友联机的在线《行动代号》桌游。深蓝极简主题，支持实时多人房间、积分模式、结算称号、全房动画特效。

---

## 当前功能

### 房间与联机
- 实时多人房间：创建房间、复制邀请链接、加入/旁观房间、重连恢复
- 队伍与角色：红队/蓝队、队长/队员、旁观者、排队加入下一局
- 社长控制：开始游戏、转让社长、强制结束对局、解散房间、回到大厅
- 房间大厅：区分准备中 / 进行中 / 已结束三种状态
- 专注模式：对局中一键收起侧栏，极简 FocusBar + 棋盘 + 操作区

### 棋盘模式
- 5×5 / 7×7 / 9×9 三种棋盘尺寸
- 翻牌动画（rotateY 翻转 + 脉冲）
- 已翻牌显示对应阵营颜色（浅红/浅蓝/浅灰/深色+glow）
- 队长视角右下角色点标记（红/蓝/灰/黑色圆环）
- 长词自动缩字号 + 换行，最多 2~3 行，不截断
- 尺寸自适应：5×5 大卡 / 7×7 中卡 / 9×9 紧凑

### 得分模式
- **经典模式**：找完己方全部词卡即获胜，分数=胜场数
- **积分模式**：每次猜词独立计分
  - 猜中己方词 +10，连击 +2×连击数
  - 猜错对方词 -5（对方+5）
  - 踩中刺客 -25（对方+25）
  - 精准奖励（猜中数=提示数） +10
  - 胜利队伍 +20
- 积分面板：实时回合明细 + 历史回合纪录

### 结算称号
每局结束后自动计算并颁发最多 7 个称号：

| 称号 | 类别 | 条件 |
|------|------|------|
| 词牌王者 | 正向 | 猜中己方词最多 |
| 神谕队长 | 正向 | 提示质量最高 |
| 羁绊连携 | 正向 | 队长×队员最佳搭档 |
| 名场面密令 | 正向 | 单回合收益最高的提示 |
| 主角光环持有者 | 正向 | 连续猜中最长 |
| 友军认证失败 | 搞笑 | 猜中对方词最多 |
| 死亡 Flag 回收者 | 搞笑 | 翻开刺客词 |
| 保守派军师 | 氛围 | 提前结束回合最多 |
| 队魂担当 | 氛围 | 聊天/互动最活跃 |

### 题库系统
- **内置题库**：自带 ACG 词库
- **我的题库**：登录后上传/管理个人题库，公开/取消公开
- **公共题库**：浏览其他玩家的公开题库，直接复用于开房
- **题库搜索**：按名称筛选
- **详情弹窗**：预览词条+管理操作（公开/删除）

### 社交互动
- 聊天：快捷短语 + 自由输入
- 送花 / 丢鸡蛋：全房广播动画（花瓣 burst + 屏幕 shake + 横幅）
- 旁观模式 + 排队加入下一局

### 账户系统
- 用户名登录（无需密码），保存题库和战绩
- 游客模式快速进入
- 切换账户 / 退出登录
- 上传头像
- 离线玩家重进房间自动恢复（同名断线记录自动替换）

---

## 路由结构

| 路径 | 内容 |
|------|------|
| `/login` | 登录页（用户名/游客） |
| `/` | 大厅（创建/加入房间 + 公开房间列表） |
| `/create` | 开房设置 |
| `/packs` | 题库管理 |
| `/profile` | 个人资料 |
| `/room/:id` | 游戏房间 |

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 · TypeScript · Vite |
| 后端 | Node.js · Express · Socket.IO |
| 共享包 | TypeScript 类型、常量、视图裁剪逻辑 |
| 存储 | 内存房间存储 + JSON 文件用户数据 |
| 部署 | Nginx 静态文件 + Node 后端 |

---

## 本地开发

### 环境要求
- Node.js 20+
- npm

### 安装

```bash
npm install
```

### 启动后端

```bash
npm run dev:server
```

默认监听 `http://localhost:3001`

### 启动前端

```bash
npm run dev:web
```

默认访问 `http://localhost:5173`

### 构建

```bash
npm run build
```

---

## 环境变量

### 后端 `apps/server/.env`

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3001` | 后端端口 |
| `CLIENT_ORIGIN` | `http://localhost:5173` | 跨域前端地址 |
| `USE_MEMORY_STORE` | `0` | 强制内存存储 |
| `ENABLE_DEBUG_TOOLS` | `1` | 调试工具开关 |
| `USER_STORE_FILE` | `apps/server/data/users.json` | 用户数据路径 |

### 前端 `apps/web/.env`

| 变量 | 默认值 | 说明 |
|---|---|---|
| `VITE_SERVER_URL` | `http://localhost:3001` | 后端地址 |

---

## 部署

### 构建

```bash
npm install
npm run build
```

产物：`apps/web/dist/`（前端）、`apps/server/dist/`（后端）、`packages/shared/dist/`

### 启动后端

```bash
npm run start -w @acg-codenames/server
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
        proxy_read_timeout 86400;
    }
}
```

---

## 目录结构

```text
acg_codenames/
├── apps/
│   ├── server/src/
│   │   ├── index.ts        # HTTP + Socket.IO 入口
│   │   ├── game.ts         # 房间对局引擎
│   │   ├── store.ts        # 房间存储
│   │   └── user-store.ts   # 用户题库存储
│   └── web/src/
│       ├── App.tsx         # 路由主入口
│       ├── context/
│       │   └── GameContext.tsx  # 全局状态+Socket事件
│       ├── routes/         # 页面组件
│       └── styles.css      # 主题样式
├── packages/shared/src/
│   ├── types.ts            # 共享类型
│   ├── socket.ts           # Socket 事件类型
│   ├── constants.ts        # 常量
│   └── view.ts             # 视图裁剪+权限计算
└── README.md
```
