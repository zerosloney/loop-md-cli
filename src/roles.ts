/**
 * agent 角色 → 工具白名单 / 权限模式映射，按 **role**（orchestrator / executor / reviewer）索引。
 *
 * 关键设计：用 role 而不是 agent name 做索引，让任意领域的同名角色（如 ralph-reviewer /
 * writing-reviewer / code-reviewer）共享同一份只读契约——避免新增领域时遗漏权限收口。
 *
 * 三族共用约定（named / codebuddy / trae）：
 *   reviewer(只读)  → Read, Grep, Glob, Bash（trae 不给 Bash）
 *   builder(可写)   → 继承全部工具(留空字符串 = 不写 tools 字段)
 *   orchestrator    → 继承全部工具
 *
 * 留空 = 继承全部工具（不在 frontmatter 写 tools 字段）。
 */

import { AGENT_ROLES } from "./registry.js";

// named 族 + codebuddy 族共用：按 role 索引，留空 = 继承全部工具
export const ROLE_TOOLS: Record<string, string> = {
  reviewer: "Read, Grep, Glob, Bash", // 只读
  // orchestrator / executor 留空 = 继承全部
};

// codebuddy 族 permissionMode，按 role 索引
export const ROLE_PERMISSION_MODE: Record<string, string> = {
  reviewer: "plan", // 只读审查
  executor: "acceptEdits", // 可写
  orchestrator: "default", // 主控
};

// trae 族 tools（小写 + camelCase，参照官方文档）
// 按 role 索引；留空 = 继承全部工具（不写 tools 字段）
export const TRAE_TOOLS: Record<string, string> = {
  reviewer: "Read, Grep, Glob", // 只读审查（无 Bash）
  // orchestrator / executor 留空 = 继承全部
};

/**
 * 从 agent name 推断 role（orchestrator / executor / reviewer）。
 * 精确匹配 → 后缀匹配（code-executor → executor）→ 前缀匹配（test-orchestrator → orchestrator）→ 默认 orchestrator。
 *
 * 在 renderer 里作为 src.role 缺失时的回退，保留向后兼容。
 */
export function findAgentRole(name: string): string {
  if (AGENT_ROLES.includes(name)) return name;
  const parts = name.split("-");
  for (let i = parts.length - 1; i >= 0; i--) {
    if (AGENT_ROLES.includes(parts[i])) return parts[i];
  }
  if (parts.length > 1 && AGENT_ROLES.includes(parts[0])) return parts[0];
  return "orchestrator";
}
