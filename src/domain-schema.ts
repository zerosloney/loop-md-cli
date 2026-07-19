/**
 * 领域文件 Schema 深度校验。
 *
 * 在 readDomainFile 的基础上增加结构化约束：
 *   - id: 非空字符串
 *   - agents[].role: 必须是已知角色（orchestrator/executor/reviewer）
 *   - agents[].name, description: 非空字符串
 *   - commands[].role: 必须是已知角色（loop）
 *   - commands[].name, description: 非空字符串
 *   - backpressure: 可选，断路器配置
 *   - 同一集合内 name 不重复
 *   - 至少包含一个 orchestrator 和一个 loop 命令
 */

import { readFileSync } from "node:fs";
import { AGENT_ROLES, COMMAND_ROLES } from "./registry.js";

export interface BackpressureConfig {
  type: "test" | "lint" | "custom";
  command: string;
  max_failures: number;
  retry_on_failure?: boolean;
}

export interface ResolvedDomain {
  id: string;
  agents: { role: string; name: string; description: string }[];
  commands: { role: string; name: string; description: string }[];
  backpressure?: BackpressureConfig;
}

/** 领域文件中每个字段的校验结果。 */
export interface FieldError {
  field: string;
  message: string;
}

/** 校验领域 JSON 对象的字段合法性。返回错误列表（空表示通过）。 */
export function validateDomainFields(domain: unknown): FieldError[] {
  const errors: FieldError[] = [];

  if (!domain || typeof domain !== "object" || Array.isArray(domain)) {
    return [{ field: ".", message: "领域文件必须是一个 JSON 对象" }];
  }

  const obj = domain as Record<string, unknown>;

  // ── id ──
  if (typeof obj.id !== "string" || obj.id.trim() === "") {
    errors.push({ field: "id", message: "必须是非空字符串" });
  }

  // ── agents ──
  if (!Array.isArray(obj.agents)) {
    errors.push({ field: "agents", message: "必须是数组" });
  } else {
    const agentNames = new Set<string>();
    const hasOrchestrator = obj.agents.some((a: unknown) => {
      if (typeof a !== "object" || a === null) return false;
      const agent = a as Record<string, unknown>;
      return agent.role === "orchestrator";
    });

    for (let i = 0; i < obj.agents.length; i++) {
      const agent = obj.agents[i];
      const prefix = `agents[${i}]`;

      if (typeof agent !== "object" || agent === null) {
        errors.push({ field: prefix, message: "必须是对象" });
        continue;
      }

      const a = agent as Record<string, unknown>;

      // role
      if (typeof a.role !== "string" || !AGENT_ROLES.includes(a.role)) {
        errors.push({
          field: `${prefix}.role`,
          message: `必须是已知角色之一: ${AGENT_ROLES.join(", ")}`,
        });
      }

      // name
      if (typeof a.name !== "string" || a.name.trim() === "") {
        errors.push({ field: `${prefix}.name`, message: "必须是非空字符串" });
      } else if (agentNames.has(a.name)) {
        errors.push({ field: `${prefix}.name`, message: `名称 "${a.name}" 重复` });
      } else {
        agentNames.add(a.name);
      }

      // description
      if (typeof a.description !== "string" || a.description.trim() === "") {
        errors.push({ field: `${prefix}.description`, message: "必须是非空字符串" });
      }
    }

    if (!hasOrchestrator) {
      errors.push({ field: "agents", message: "必须至少包含一个 role=orchestrator 的 agent" });
    }
  }

  // ── commands ──
  if (!Array.isArray(obj.commands)) {
    errors.push({ field: "commands", message: "必须是数组" });
  } else {
    const commandNames = new Set<string>();
    const hasLoop = obj.commands.some((c: unknown) => {
      if (typeof c !== "object" || c === null) return false;
      const cmd = c as Record<string, unknown>;
      return cmd.role === "loop";
    });

    for (let i = 0; i < obj.commands.length; i++) {
      const cmd = obj.commands[i];
      const prefix = `commands[${i}]`;

      if (typeof cmd !== "object" || cmd === null) {
        errors.push({ field: prefix, message: "必须是对象" });
        continue;
      }

      const c = cmd as Record<string, unknown>;

      // role
      if (typeof c.role !== "string" || !COMMAND_ROLES.includes(c.role)) {
        errors.push({
          field: `${prefix}.role`,
          message: `必须是已知角色之一: ${COMMAND_ROLES.join(", ")}`,
        });
      }

      // name
      if (typeof c.name !== "string" || c.name.trim() === "") {
        errors.push({ field: `${prefix}.name`, message: "必须是非空字符串" });
      } else if (commandNames.has(c.name)) {
        errors.push({ field: `${prefix}.name`, message: `名称 "${c.name}" 重复` });
      } else {
        commandNames.add(c.name);
      }

      // description
      if (typeof c.description !== "string" || c.description.trim() === "") {
        errors.push({ field: `${prefix}.description`, message: "必须是非空字符串" });
      }
    }

    if (!hasLoop) {
      errors.push({ field: "commands", message: "必须至少包含一个 role=loop 的命令" });
    }
  }

  // ── backpressure（可选） ──
  if (obj.backpressure !== undefined) {
    if (typeof obj.backpressure !== "object" || obj.backpressure === null || Array.isArray(obj.backpressure)) {
      errors.push({ field: "backpressure", message: "必须是对象" });
    } else {
      const bp = obj.backpressure as Record<string, unknown>;
      if (!["test", "lint", "custom"].includes(bp.type as string)) {
        errors.push({ field: "backpressure.type", message: "必须是 test | lint | custom" });
      }
      if (typeof bp.command !== "string" || bp.command.trim() === "") {
        errors.push({ field: "backpressure.command", message: "必须是非空字符串" });
      }
      if (typeof bp.max_failures !== "number" || !Number.isInteger(bp.max_failures) || bp.max_failures < 1) {
        errors.push({ field: "backpressure.max_failures", message: "必须是 >= 1 的整数" });
      }
    }
  }

  return errors;
}

/** 校验并返回 ResolvedDomain，失败时抛出结构化错误。 */
export function readDomainFile(path: string): ResolvedDomain {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    throw new Error(`无法读取领域文件 ${path}: ${(err as Error).message}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`领域文件 JSON 解析失败 (${path}): ${(err as Error).message}`);
  }

  const fieldErrors = validateDomainFields(json);
  if (fieldErrors.length > 0) {
    const msg = fieldErrors.map((e) => `  ${e.field}: ${e.message}`).join("\n");
    throw new Error(`领域文件校验失败 (${path}):\n${msg}`);
  }

  // 类型断言已通过校验
  const obj = json as Record<string, unknown>;
  const domain: ResolvedDomain = {
    id: obj.id as string,
    agents: (obj.agents as unknown[]).map((a) => {
      const agent = a as Record<string, unknown>;
      return {
        role: agent.role as string,
        name: agent.name as string,
        description: agent.description as string,
      };
    }),
    commands: (obj.commands as unknown[]).map((c) => {
      const cmd = c as Record<string, unknown>;
      return {
        role: cmd.role as string,
        name: cmd.name as string,
        description: cmd.description as string,
      };
    }),
  };

  if (obj.backpressure && typeof obj.backpressure === "object" && !Array.isArray(obj.backpressure)) {
    const bp = obj.backpressure as Record<string, unknown>;
    domain.backpressure = {
      type: bp.type as "test" | "lint" | "custom",
      command: bp.command as string,
      max_failures: bp.max_failures as number,
      retry_on_failure: bp.retry_on_failure as boolean | undefined,
    };
  }

  return domain;
}
