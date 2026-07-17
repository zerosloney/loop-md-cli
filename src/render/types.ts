/**
 * Renderer 接口：按平台族渲染 agent / command 的 frontmatter。
 * 正文（body）由调用方拼接，renderer 只负责 frontmatter 块。
 */
import type { AgentSource, CommandSource } from "../source.js";
import type { Platform } from "../platforms.js";

export interface Renderer {
  renderAgent(src: AgentSource, platform: Platform): string; // 返回完整 .md（frontmatter + body）
  renderCommand(src: CommandSource, platform: Platform): string;
}

/** 拼接 frontmatter 块 + 空行 + 正文。frontmatter 块以 --- 包裹。 */
export function assemble(lines: string[], body: string): string {
  return ["---", ...lines, "---"].join("\n") + "\n\n" + body;
}
