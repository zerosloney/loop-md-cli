/**
 * Renderer 接口：按平台族渲染 agent / command 的 frontmatter。
 * 正文（body）由调用方拼接，renderer 只负责 frontmatter 块。
 */
import type { Frontmatter } from "../frontmatter.js";
import type { Platform } from "../platforms.js";

export interface AgentSource {
  name: string;
  description: string;
  frontmatter: Frontmatter;
  body: string;
  /** agent 角色（orchestrator / executor / reviewer），用于按 role 索引工具白名单/权限模式。 */
  role?: string;
  /** 子 agent 模型（可选），不填则继承主 Agent 当前模型；named/codebuddy/trae/qwen/mode 族通用。 */
  model?: string;
}

export interface CommandSource {
  name: string;
  description: string;
  frontmatter: Frontmatter;
  body: string;
}

export interface Renderer {
  renderAgent(src: AgentSource, platform: Platform): string; // 返回完整 .md（frontmatter + body）
  renderCommand(src: CommandSource, platform: Platform): string;
}

/** 拼接 frontmatter 块 + 空行 + 正文。frontmatter 块以 --- 包裹。 */
export function assemble(lines: string[], body: string): string {
  return ["---", ...lines, "---"].join("\n") + "\n\n" + body;
}

/**
 * 判断 value 作为 YAML plain scalar 是否会产生歧义（需要加引号）。
 * 保守策略：只在真正会被误解析时才返回 true，安全值原样输出，避免改变既有产物。
 */
function needsYamlQuoting(value: string): boolean {
  if (value === "") return true;
  if (value !== value.trim()) return true; // 首尾空白
  if (value.includes("\n")) return true; // 换行
  if (value.includes(": ") || value.endsWith(":")) return true; // 会被解析成 mapping
  if (value.includes(" #")) return true; // 会被解析成注释
  if (/^[-?:,[\]{}&*!|>'"%@`#]/.test(value)) return true; // 以指示符开头
  if (/^(true|false|null|~|yes|no|on|off)$/i.test(value)) return true; // bool/null 强转
  if (/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(value)) return true; // 数字强转
  return false;
}

/**
 * 把自由文本标量（name / description / model）安全地渲染为 YAML 字符串。
 * 仅在值会被误解析时加双引号并转义，安全值原样返回（不改变既有输出）。
 *
 * 注意：不适用于 role 索引的常量（tools / permissionMode 等）与 frontmatter 透传值
 * （temperature / disallowedTools: [Write, Edit] 等）——它们是受控值或本就是 YAML 片段。
 */
export function escapeYamlValue(value: string): string {
  if (!needsYamlQuoting(value)) return value;
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  return `"${escaped}"`;
}
