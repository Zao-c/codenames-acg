# Reveal Guess / 揭幕猜番

## 玩法说明

揭幕猜番是一款派对猜图游戏。一张动画截图被 9×9 白色格子遮住，玩家通过翻牌逐步揭开画面，猜测画面出自哪部作品。

### 角色

| 角色 | 权限 |
|------|------|
| **Judge（裁判 / 出题人）** | 创建房间并上传题目（图片、答案、别名、提示）。游戏过程中可以看到完整原图、标准答案、所有玩家提交的答案文本。负责判定答案是否正确、开放抢答、发送提示、跳过题目、手动调整分数。 |
| **Player（玩家）** | 点击格子翻牌（每题最多翻 1 格）。翻牌后获得优先猜答权。可以提交正式答案。抢答阶段可以抢答。 |
| **Spectator（观众）** | 只能观看和聊天，不能翻牌或答题。 |

### 流程

1. Judge 创建房间，选择「揭幕猜番」模式，设置题目数量
2. Judge 上传题目（图片 URL / data URL + 答案 + 别名 + 预设提示）
3. 玩家加入房间
4. Judge 点击「开始游戏」，进入第一题
5. **自由翻牌阶段**：玩家点击格子翻开，翻牌后获得优先猜答权。每位玩家每题最多翻 1 格
6. 玩家提交答案（优先猜答 / 正式提交），答案私密发送给裁判
7. **裁判判定**：裁判看到答案后判定正确 / 错误 / 要求补充
8. 如果判错，裁判可以开放抢答
9. **抢答阶段**：玩家抢答并提交答案，裁判判定
10. 答对后进入本题结束，显示正确答案
11. 裁判点击「下一题」进入下一题，或全部结束后游戏结束

### 计分规则

- 基础分 = max(10, 100 − 已翻格子数)
- 自翻自猜额外 +10
- 翻牌助攻（别人猜中你翻的格子）+5
- 裁判可手动加减分

### 题目格式

- 图片：支持 HTTP URL 或 data URL（base64），建议压缩到 500KB 以内
- 答案：标准答案文本
- 别名（可选）：评测答案时也接受的别名，每行一个
- 提示（可选）：裁判可以逐步发出的提示，每行一个

---

## 技术架构

### 服务端

- `apps/server/src/reveal-guess.ts` — 纯函数模式的核心游戏逻辑
- `apps/server/src/index.ts` — Socket.IO 事件处理，接入 reveal-guess 函数
- `apps/server/src/game.ts` — 原有 Codenames 逻辑，未受新功能影响

### 客户端

- `apps/web/src/components/reveal-guess/RevealGuessRoom.tsx` — 揭幕猜番房间 UI
- `apps/web/src/components/reveal-guess/useRevealGuessActions.ts` — Socket 事件封装

### 共享类型

- `packages/shared/src/types.ts` — GameMode、RevealGuessState、PublicRevealGuessState 等
- `packages/shared/src/socket.ts` — ClientToServerEvents / ServerToClientEvents
- `packages/shared/src/constants.ts` — 默认设置常量

### 数据流

```
客户端 emit("reveal_guess_reveal_cell") 
  → 服务端 index.ts socket handler 
  → reveal-guess.ts revealCell() 纯函数
  → 服务端 store.setRoom() 持久化
  → 服务端 sendRoomState() 广播给所有成员
  → 客户端收到 room_state → React 重渲染
```

---

## 本地开发

### 环境要求

- Node.js ≥ 18
- npm ≥ 9

### 启动开发服务器

```bash
# 安装依赖
npm install

# 启动后端 (http://localhost:3001)
npm run dev:server

# 启动前端 (http://localhost:5173)
npm run dev:web
```

### 运行测试

```bash
# 类型检查
npm run typecheck --workspaces

# 服务端单元测试
node --experimental-strip-types apps/server/test/reveal-guess.test.ts

# 服务端 E2E 测试（需要先启动 dev server）
npm run test:e2e -w @acg-codenames/server

# 构建
npm run build
```

### 测试揭幕猜番功能

1. 打开浏览器访问 `http://localhost:5173`
2. 以游客身份登录（输入昵称）
3. 点击「创建房间」→ 选择「揭幕猜番」模式
4. 填写题目信息（可使用测试图片 data URL）
5. 创建后，在另一个浏览器标签页打开，以游客身份加入房间
6. Judge 点击「开始游戏」，然后自由测试各功能

---

## 未实现 / 后续建议

### 高优先级

- [ ] 图片上传压缩（当前仅支持文本输入 URL / data URL）
- [ ] 移动端裁判面板适配（当前裁判面板在手机上较拥挤）
- [ ] 答案模糊匹配辅助裁判（裁判看到玩家答案与标准答案的相似度）
- [ ] 翻牌动画（当前为即时切换，建议添加 CSS 翻转效果）

### 中优先级

- [ ] 多裁判支持（当前仅一名出题人）
- [ ] 预设题目集导入（批量上传）
- [ ] 抢答自动计时（timerEnabled 时自动关闭抢答）
- [ ] 玩家答题历史面板
- [ ] 回放 / 复盘功能

### 低优先级

- [ ] 成就系统（类似 Codenames 的称号）
- [ ] 自定义棋盘大小（当前固定 9×9）
- [ ] 多题目同时上传
- [ ] 裁判自由输入提示（不限预设列表）

### Codenames 兼容性

- Codenames 模式完全不受影响，新增的功能均为增量
- `RoomSettings.ruleSet` 新增 `"reveal-guess"` 选项，默认为 `"codenames"`
- `Room.revealGuessState` 为可选字段，仅 reveal-guess 房间使用
- 所有现有测试和功能保持不变
