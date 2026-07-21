/**
 * 平台数据表 — 数据驱动，新增平台只加一行。
 *
 * 路径映射参照 Trellis platform-map.md。每平台声明：
 *   id      平台标识（也是 CLI flag 名，--<id>）
 *   dir     输出目录
 *   family  frontmatter 渲染族：
 *             "named"    → name + description + tools(白名单), claude/qoder
 *             "mode"     → description + mode + temperature/steps + permission(细粒度), opencode/kilo
 *             "codebuddy"→ name + description + model:inherit + tools + permissionMode
 *             "trae"     → name + description + tools(小写 + camelCase)
 *   note    人类可读说明（--list 显示）
 */

export type Family = "named" | "mode" | "codebuddy" | "trae" | "qwen";

export interface Platform {
  id: string;
  dir: string;
  family: Family;
  note: string;
}

export const PLATFORMS: Record<string, Platform> = {
  // ── named 族：name + description + tools ──
  claude: { id: "claude", dir: ".claude", family: "named", note: "Claude Code" },
  qoder: { id: "qoder", dir: ".qoder", family: "named", note: "Qoder CLI(子 agent 用 Agent 工具调度，tools 大写 PascalCase)" },
  // ── trae 族：name + description + tools(小写 + camelCase) ──
  trae: {
    id: "trae",
    dir: ".trae",
    family: "trae",
    note: "Trae IDE(项目级 .trae/agents，frontmatter: name/description/tools；model 继承 IDE 当前 Agent)",
  },
  // ── mode 族：description + mode + permission(细粒度，从源提取) ──
  opencode: { id: "opencode", dir: ".opencode", family: "mode", note: "OpenCode" },
  kilo: {
    id: "kilo",
    dir: ".kilo",
    family: "mode",
    note: "Kilo Code(注:Trellis 用 .kilocode/，此处按用户指定用 .kilo)",
  },
  // ── codebuddy 族：name + description + model:inherit + tools + permissionMode ──
  codebuddy: { id: "codebuddy", dir: ".codebuddy", family: "codebuddy", note: "CodeBuddy" },
  // ── qwen 族：name + description + model + tools + disallowedTools + approvalMode ──
  qwen: { id: "qwen", dir: ".qwen", family: "qwen", note: "Qwen Code" },
};

export const PLATFORM_KEYS = Object.keys(PLATFORMS);
