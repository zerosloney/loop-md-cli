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
import { assemble, escapeYamlValue } from "./types.js";

export class CodeBuddyRenderer implements Renderer {
  renderAgent(src: AgentSource, _platform: Platform): string {
    const lines = [
      `name: ${escapeYamlValue(src.name)}`,
      `description: ${escapeYamlValue(src.description)}`,
    ];
    const role = src.role ?? findAgentRole(src.name);
    // model: 优先使用指定模型（来自 CLI 或领域配置），无则回落 inherit
    lines.push(`model: ${escapeYamlValue(src.model ?? "inherit")}`);
    const tools = ROLE_TOOLS[role] ?? "";
    if (tools) lines.push(`tools: ${tools}`);
    lines.push(`permissionMode: ${ROLE_PERMISSION_MODE[role] ?? "default"}`);
    return assemble(lines, src.body);
  }

  renderCommand(src: CommandSource, _platform: Platform): string {
    return assemble([`description: ${escapeYamlValue(src.description)}`], src.body);
  }
}
