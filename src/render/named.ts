/**
 * named 族（claude / qoder）：
 *   name + description + tools（白名单，来自 ROLE_TOOLS；留空 = 继承全部，不写 tools 字段）
 *
 * tools 按 **role** 索引（reviewer = 只读；orchestrator/executor = 继承全部），
 * src.role 缺失时回退到 findAgentRole(src.name) 保向后兼容。
 */
import { ROLE_TOOLS, findAgentRole } from "../roles.js";
import type { Platform } from "../platforms.js";
import type { AgentSource, CommandSource } from "./types.js";
import type { Renderer } from "./types.js";
import { assemble, escapeYamlValue } from "./types.js";

export class NamedRenderer implements Renderer {
  renderAgent(src: AgentSource, _platform: Platform): string {
    const lines = [
      `name: ${escapeYamlValue(src.name)}`,
      `description: ${escapeYamlValue(src.description)}`,
    ];
    const role = src.role ?? findAgentRole(src.name);
    const tools = ROLE_TOOLS[role] ?? "";
    if (tools) lines.push(`tools: ${tools}`);
    // model: 可选，来自 CLI 或领域配置；不指定时省略（继承当前会话模型）
    if (src.model) lines.push(`model: ${escapeYamlValue(src.model)}`);
    return assemble(lines, src.body);
  }

  renderCommand(src: CommandSource, _platform: Platform): string {
    return assemble([`description: ${escapeYamlValue(src.description)}`], src.body);
  }
}
