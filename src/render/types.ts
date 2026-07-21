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
  /** Trae 子 agent 模型（可选），不填则继承主 Agent 当前模型。 */
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
