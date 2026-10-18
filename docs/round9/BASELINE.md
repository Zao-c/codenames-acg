# Round 9 开发基线

2026-10-19（北京时间）只读核对：

- 用户提供 Round 8：211401ee46bf205333d5a220d057a6fa09c71200。
- 远端 codex/cipai-round8 同上；实际生产 Git HEAD、release.json、远端 codex/cipai-performance 均为 59f2bd1aad922bad41d42b63ca0857b0102ad0b1。
- 两者差异为一笔性能修复，保留目录按需读取、头像资源引用、增量状态与封面迟到恢复。
- 远端 main 为 1b8a8709a067aa2bfc002a29ef3c2aa31785efa7，是旧祖先，不能用作实现基线。
- 独立 worktree `.worktrees/round9` / codex/cipai-round9 基于 59f2bd1；原目录、其它 worktree 和未跟踪附件均保留。
- 正式 Socket 进程确认运行，实际服务 active，health ok；检查时房间列表为空。生产没有 tracked 修改；持久化目录及已有切换备份存在。未读取/记录用户凭证、头像全文和私人阵容。
- 完整阅读附件六份 Markdown，并通过 Chromium 打开自包含 HTML，检查桌面和手机原型。原型及截图裁切只作本地评审，不复制为生产素材。

本轮不部署、不重启正式服务、不做生产压力测试。后续发布需另外授权、重新核对活跃房间及版本，停止写入后备份持久化数据；回滚代码不得回滚用户数据。内存房间不能通过磁盘备份恢复。
