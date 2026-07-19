/**
 * named 族（claude / omp / qoder）：
 *   name + description + tools（白名单，来自 ROLE_TOOLS；留空 = 继承全部，不写 tools 字段）
 */
import { ROLE_TOOLS } from "../roles.js";
import type { Platform } from "../platforms.js";
import type { AgentSource, CommandSource } from "./types.js";
import type { Renderer } from "./types.js";
import { assemble } from "./types.js";

export class NamedRenderer implements Renderer {
  renderAgent(src: AgentSource, _platform: Platform): string {
    const lines = [`name: ${src.name}`, `description: ${src.description}`];
    const tools = ROLE_TOOLS[src.name] ?? "";
    if (tools) lines.push(`tools: ${tools}`);
    return assemble(lines, src.body);
  }

  renderCommand(src: CommandSource, _platform: Platform): string {
    return assemble([`description: ${src.description}`], src.body);
  }
}
