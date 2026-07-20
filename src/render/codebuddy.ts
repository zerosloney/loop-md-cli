/**
 * codebuddy 族（CodeBuddy）：
 *   name + description + model:inherit + tools（ROLE_TOOLS）+ permissionMode（ROLE_PERMISSION_MODE）
 *
 * tools / permissionMode 按 **role** 索引（reviewer = 只读 + plan；executor = acceptEdits；
 * orchestrator = default）。src.role 缺失时回退到 findAgentRole(src.name)。
 */
import { ROLE_TOOLS, ROLE_PERMISSION_MODE, findAgentRole } from "../roles.js";
import type { Platform } from "../platforms.js";
import type { AgentSource, CommandSource } from "./types.js";
import type { Renderer } from "./types.js";
import { assemble } from "./types.js";

export class CodeBuddyRenderer implements Renderer {
  renderAgent(src: AgentSource, _platform: Platform): string {
    const lines = [`name: ${src.name}`, `description: ${src.description}`, "model: inherit"];
    const role = src.role ?? findAgentRole(src.name);
    const tools = ROLE_TOOLS[role] ?? "";
    if (tools) lines.push(`tools: ${tools}`);
    lines.push(`permissionMode: ${ROLE_PERMISSION_MODE[role] ?? "default"}`);
    return assemble(lines, src.body);
  }

  renderCommand(src: CommandSource, _platform: Platform): string {
    return assemble([`description: ${src.description}`], src.body);
  }
}
