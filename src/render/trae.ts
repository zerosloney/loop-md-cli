/**
 * trae 族（Trae IDE）：
 *   name + description + tools（小写 + camelCase，来自 TRAE_TOOLS；reviewer 只读不给 Bash）
 *   model 省略（继承 IDE 中 Agent 当前模型）
 *
 * tools 按 **role** 索引（reviewer = read/grep/glob 无 Bash；orchestrator/executor = 继承全部），
 * src.role 缺失时回退到 findAgentRole(src.name)。
 */
import { TRAE_TOOLS, findAgentRole } from "../roles.js";
import type { Platform } from "../platforms.js";
import type { AgentSource, CommandSource } from "./types.js";
import type { Renderer } from "./types.js";
import { assemble } from "./types.js";

export class TraeRenderer implements Renderer {
  renderAgent(src: AgentSource, _platform: Platform): string {
    const lines = [`name: ${src.name}`, `description: ${src.description}`];
    const role = src.role ?? findAgentRole(src.name);
    const tools = TRAE_TOOLS[role] ?? "";
    if (tools) lines.push(`tools: ${tools}`);
    return assemble(lines, src.body);
  }

  // trae 族命令带 name 字段（与原 generate.py render_command 对齐）
  renderCommand(src: CommandSource, _platform: Platform): string {
    const lines = [`name: ${src.name}`, `description: ${src.description}`];
    return assemble(lines, src.body);
  }
}
