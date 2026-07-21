/**
 * mode 族（opencode / kilo）：
 *   description + mode + temperature + steps + permission（细粒度，从源 frontmatter 透传）
 *
 * permission 是结构化 YAML map（OpenCode 按 permission.bash["*"] 访问），
 * 必须按嵌套 map 输出，不能用 block scalar (`|`) —— 否则目标端解析成字符串。
 * 标量字段（mode/temperature/steps 等）按原样输出。
 */
import type { Platform } from "../platforms.js";
import type { AgentSource, CommandSource } from "./types.js";
import type { Renderer } from "./types.js";
import { assemble } from "./types.js";

const MODE_FIELDS = ["mode", "temperature", "steps", "permission"] as const;

const TOP_KEY_RE = /^["']?[A-Za-z][\w-]*["']?:/;

/**
 * 判断 value 是否是 YAML map 块（第一行去掉前导空白后匹配 `key: value` 形式）。
 * 用于 permission 这类结构化字段：作为嵌套 map 输出，而非 block scalar。
 *
 * 注意：parseFrontmatter 收集块值时保留缩进，首行通常有前导空格，需 trim 后判断。
 */
function looksLikeYamlMap(value: string): boolean {
  const firstLine = value.split("\n", 1)[0].trimStart();
  return TOP_KEY_RE.test(firstLine);
}

function formatFrontmatterValue(key: string, value: string): string {
  if (value.includes("\n")) {
    if (looksLikeYamlMap(value)) {
      // 结构化字段（permission 等）：原样缩进，整体成为 key 的嵌套 map。
      // 源文本本身就是合法 YAML map body，缩进后 YAML 解析器解析成 dict。
      const indented = value.split("\n").map((l) => `  ${l}`).join("\n");
      return `${key}:\n${indented}`;
    }
    // 纯文本多行：block scalar
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
    // model: 可选，来自 CLI 或领域配置；不指定时省略（继承主 Agent 模型）
    if (src.model) lines.push(`model: ${src.model}`);
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
