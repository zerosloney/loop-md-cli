/**
 * qwen 族（Qwen Code）：
 *   name + description + model（可选）+ tools（白名单）+ disallowedTools（可选）+ approvalMode
 *
 * tools / disallowedTools / approvalMode 按 **role** 索引（reviewer = 只读 + plan 模式；
 * orchestrator/executor = 继承全部 + auto-edit）。
 * src.role 缺失时回退到 findAgentRole(src.name)。
 */
import { ROLE_TOOLS, QWEN_APPROVAL_MODE, QWEN_DISALLOWED_TOOLS, findAgentRole } from "../roles.js";
import type { Platform } from "../platforms.js";
import type { AgentSource, CommandSource } from "./types.js";
import type { Renderer } from "./types.js";
import { assemble, escapeYamlValue } from "./types.js";

export class QwenRenderer implements Renderer {
  renderAgent(src: AgentSource, _platform: Platform): string {
    const lines = [
      `name: ${escapeYamlValue(src.name)}`,
      `description: ${escapeYamlValue(src.description)}`,
    ];
    const role = src.role ?? findAgentRole(src.name);
    // model: 可选，来自 CLI 或领域配置；不指定时省略（继承主会话模型）
    if (src.model) lines.push(`model: ${escapeYamlValue(src.model)}`);
    // tools: 按 role 索引白名单
    const tools = ROLE_TOOLS[role] ?? "";
    if (tools) lines.push(`tools: ${tools}`);
    // disallowedTools: reviewer 额外显式禁止 Write/Edit
    const disallowed = QWEN_DISALLOWED_TOOLS[role] ?? "";
    if (disallowed) lines.push(`disallowedTools: ${disallowed}`);
    // approvalMode: 按 role 索引
    lines.push(`approvalMode: ${QWEN_APPROVAL_MODE[role] ?? "auto-edit"}`);
    return assemble(lines, src.body);
  }

  renderCommand(src: CommandSource, _platform: Platform): string {
    return assemble([`description: ${escapeYamlValue(src.description)}`], src.body);
  }
}
