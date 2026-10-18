# Round 10 V2 基线与执行边界

- 附件已解压为根目录的 Round10_V2 评审包；阅读 README、完整补丁说明、去除内嵌图片编码后的 HTML，并通过 Chromium 实际打开全部视图、设置保存/取消；检查六张桌面/手机参考 PNG。参考素材仅用于本地评审。
- 原工作区 HEAD `1baae81`，无 tracked 修改；存在用户未跟踪附件和脚本，全部保留。Round 9 worktree HEAD `26fe2ab`，clean。
- GitHub 最新 main `f4dba9877b98a2b154d417007254857b7728a35d`（合并 PR #17），包含 Round 9 应用代码到 `3be9ac9`。与最终 Round 9 `26fe2ab` 的运行代码没有差异，仅缺后续测试修正和评审证据。
- 独立 worktree `.worktrees/round10-v2`，分支 `codex/cipai-round10-v2`，从 origin/main 创建；合入已检查的 Round 9 后续测试/证据，集成基线 `2d881e9f9fd355141d0037b5c337cd7b2d9bdb98`。没有用旧应用代码覆盖 main。
- 开始时只读 SSH 核实生产 Git/release.json `59f2bd1aad922bad41d42b63ca0857b0102ad0b1`，分支 `codex/cipai-performance`，tracked clean；`codenames.service` active，PID `1007817`，health 正常，房间列表为空。
- 新设置弹窗复用原有入口、表单、服务端事件与权限；仅补齐草稿、确认、异常恢复和手机全屏。原有 host 管理、通知、增量同步均复用，不重复实现。
- 运行规则保持既有 180 秒和选牌期间干扰；新时长、独立干扰、manual-only 互换及关联板共享提案不启用。
- 本轮用户明确要求最终 SSH 部署，覆盖附件的“没有授权不部署”提醒。发布前必须完成测试、截图、PR，重新核实空房和版本，停止写入后做一致性备份；有真实房间时不强制重启。记录发布 SHA、备份、构建与回滚，保留最新用户数据。
