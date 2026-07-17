/**
 * mode 族（opencode / kilo）：
 *   description + mode + temperature + steps + permission（细粒度，从源 frontmatter 透传）
 *
 * 这些字段以源 frontmatter 为单一真相，不做结构化解析（permission 块原样透传以保留注释与顺序）。
 */
import type { Platform } from "../platforms.js";
import type { AgentSource, CommandSource } from "../source.js";
import type { Renderer } from "./types.js";
import { assemble } from "./types.js";

const MODE_FIELDS = ["mode", "temperature", "steps", "permission"] as const;

export class ModeRenderer implements Renderer {
  renderAgent(src: AgentSource, _platform: Platform): string {
    const lines = [`description: ${src.description}`];
    for (const field of MODE_FIELDS) {
      const v = src.frontmatter[field];
      if (v !== undefined && v !== "") lines.push(`${field}: ${v}`);
    }
    return assemble(lines, src.body);
  }

  renderCommand(src: CommandSource, _platform: Platform): string {
    // mode 族命令带 agent + subtask 字段（与原 generate.py render_command 对齐）
    // 这两个字段从源 frontmatter 提取，缺失则用默认（agent 名通常由源声明）
    const agent = src.frontmatter["agent"];
    const subtask = src.frontmatter["subtask"];
    const lines = [`description: ${src.description}`];
    if (agent) lines.push(`agent: ${agent}`);
    if (subtask) lines.push(`subtask: ${subtask}`);
    return assemble(lines, src.body);
  }
}
