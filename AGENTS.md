# Project Status

- 本地项目目录：C:\Users\91801\Documents\seven_big
- 项目名称：Speak2Draw-Agent-Studio
- 远程 GitHub 仓库：https://github.com/lijiony/Speak2Draw-Agent-Studio
- 当前阶段：本地仓库关联远程仓库阶段

# Repository Rules

- 所有开发必须基于 Git 记录推进。
- 禁止最后一天一次性导入全部代码。
- 新功能必须通过独立分支和 PR 添加。
- 每个 PR 只做一件事。
- PR 描述必须包含标题、功能描述、实现思路、测试方式。
- main 分支必须始终保持可运行状态。
- 不要提交 .env、token、密钥、账号密码等敏感信息。

# Coding Tasks

When spawning Claude Code sessions for coding work, tell the session to use gstack skills.

Examples:

- Security audit: "Load gstack. Run /cso"
- Code review: "Load gstack. Run /review"
- QA test a URL: "Load gstack. Run /qa https://..."
- Build a feature end-to-end: "Load gstack. Run /autoplan, implement the plan, then run /ship"
- Plan before building: "Load gstack. Run /office-hours then /autoplan. Save the plan, don't implement."
