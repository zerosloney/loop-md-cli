/**
 * mode 族（opencode / kilo）：
 *   description + mode + temperature + steps + permission（细粒度，从源 frontmatter 透传）
 *
 * 这些字段以源 frontmatter 为单一真相，不做结构化解析（permission 块原样透传以保留注释与顺序）。
 */
import type { Platform } from "../platforms.js";
import type { AgentSource, CommandSource } from "./types.js";
import type { Renderer } from "./types.js";
import { assemble } from "./types.js";

const MODE_FIELDS = ["mode", "temperature", "steps", "permission"] as const;

function formatFrontmatterValue(key: string, value: string): string {
  if (value.includes("\n")) {
    const indented = value.split("\n").map((l) => `  ${l}`).join("\n");
    return `${key}: |\n${indented}`;
  }
  return `${key}: ${value}`;
}

export class ModeRenderer implements Renderer {
  renderAgent(src: AgentSource, _platform: Platform): string {
    const lines = [`description: ${src.description}`];
    for (const field of MODE_FIELDS) {
      const v = src.frontmatter[field];
      if (v !== undefined && v !== "") lines.push(formatFrontmatterValue(field, v));
    }
    return assemble(lines, src.body);
  }

  renderCommand(src: CommandSource, _platform: Platform): string {
    const agent = src.frontmatter["agent"];
    const subtask = src.frontmatter["subtask"];
    const lines = [`description: ${src.description}`];
    if (agent) lines.push(formatFrontmatterValue("agent", agent));
    if (subtask) lines.push(formatFrontmatterValue("subtask", subtask));
    return assemble(lines, src.body);
  }
}
