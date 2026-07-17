/**
 * agent 角色 → 工具白名单 / 权限模式映射。
 * 与原 platforms.py 的 ROLE_TOOLS / ROLE_PERMISSION_MODE / TRAE_TOOLS 对齐。
 *
 * 三族共用（named / codebuddy / trae）：
 *   reviewer(只读)  → Read, Grep, Glob, Bash
 *   builder(可写)   → 继承全部工具(留空字符串 = 不写 tools 字段)
 *   orchestrator    → 继承全部工具
 *
 * 角色 → 工具白名单的 key 统一用 agent name（code-reviewer / coverage-reviewer 同属只读 reviewer 角色）。
 */

// named 族 + codebuddy 族共用：留空 = 继承全部工具（不在 frontmatter 写 tools 字段）
export const ROLE_TOOLS: Record<string, string> = {
  "code-reviewer": "Read, Grep, Glob, Bash", // 只读
  "coverage-reviewer": "Read, Grep, Glob, Bash", // 只读（test-loop 的 reviewer）
  "code-builder": "", // 可写，继承全部
  "test-writer": "", // 可写，继承全部
  "code-orchestrator": "", // 主控，继承全部
  "test-orchestrator": "", // 主控，继承全部
};

// codebuddy 族 permissionMode
export const ROLE_PERMISSION_MODE: Record<string, string> = {
  "code-reviewer": "plan", // 只读审查
  "coverage-reviewer": "plan",
  "code-builder": "acceptEdits", // 可写
  "test-writer": "acceptEdits",
  "code-orchestrator": "default", // 主控
  "test-orchestrator": "default",
};

// trae 族 tools（工具名大写；reviewer 只读不给 Bash，参照官方 security-auditor 范式）
// 留空 = 继承全部工具（不写 tools 字段）
// 文档: https://docs.trae.cn/ide_subagents
export const TRAE_TOOLS: Record<string, string> = {
  "code-reviewer": "Read, Glob, Grep", // 只读审查
  "coverage-reviewer": "Read, Glob, Grep",
  "code-builder": "", // 可写可执行，继承全部
  "test-writer": "",
  "code-orchestrator": "", // 主控，继承全部
  "test-orchestrator": "",
};
