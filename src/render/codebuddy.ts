/**
 * codebuddy 族（CodeBuddy）：
 *   name + description + model:inherit + tools（ROLE_TOOLS）+ permissionMode（ROLE_PERMISSION_MODE）
 */
import { ROLE_TOOLS, ROLE_PERMISSION_MODE } from "../roles.js";
import type { Platform } from "../platforms.js";
import type { AgentSource, CommandSource } from "../source.js";
import type { Renderer } from "./types.js";
import { assemble } from "./types.js";

export class CodeBuddyRenderer implements Renderer {
  renderAgent(src: AgentSource, _platform: Platform): string {
    const lines = [`name: ${src.name}`, `description: ${src.description}`, "model: inherit"];
    const tools = ROLE_TOOLS[src.name] ?? "";
    if (tools) lines.push(`tools: ${tools}`);
    lines.push(`permissionMode: ${ROLE_PERMISSION_MODE[src.name] ?? "default"}`);
    return assemble(lines, src.body);
  }

  renderCommand(src: CommandSource, _platform: Platform): string {
    return assemble([`description: ${src.description}`], src.body);
  }
}
