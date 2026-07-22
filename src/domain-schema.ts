/**
 * 领域文件 Schema 深度校验。
 *
 * 领域 schema 体现三层概念：
 *
 *   engine        — 领域采用的工程范式（loop = 循环工程设计，graph = 图路由工程设计）
 *   agents        — 三角色 worker（orchestrator / executor / reviewer）
 *   commands      — engine 的入口触发器（kind="entry"），每个 command 必填 agent 字段
 *                   显式声明驱动哪个 worker（告别按 -loop 后缀硬拆）
 *
 * 校验规则：
 *   - id: 非空字符串
 *   - engine.type: 必填，必须是 "loop" 或 "graph"
 *   - agents[].role: 必须是已知 agent 角色（orchestrator/executor/reviewer）
 *   - agents[].name, description: 非空字符串
 *   - commands[].kind: 必填，必须是 "entry"
 *   - commands[].agent: 必填，必须引用已存在的 agents[].name
 *   - commands[].name, description: 非空字符串
 *   - backpressure: 可选，断路器配置（domain 顶层）
 *   - 同一集合内 name 不重复
 *   - 至少包含一个 orchestrator 和一个 entry 命令
 */

import { readFileSync } from "node:fs";
import { AGENT_ROLES, ENGINE_TYPES, COMMAND_KINDS } from "./registry.js";

export interface BackpressureConfig {
  type: "test" | "lint" | "custom";
  command: string;
  max_failures: number;
  retry_on_failure?: boolean;
}

/** 领域采用的工程范式。loop = 循环工程设计，graph = 图路由工程设计。 */
export interface EngineConfig {
  type: "loop" | "graph";
}

/** 图模式下定义的任务节点。 */
export interface TaskDefinition {
  id: string;
  title: string;
  depends_on?: string[];
  accept_criteria?: string[];
}



export interface ResolvedDomain {
  id: string;
  engine: EngineConfig;
  agents: { role: string; name: string; description: string; model?: string }[];
  commands: { kind: string; agent: string; name: string; description: string }[];
  tasks?: TaskDefinition[];
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

  // ── engine（必填，领域工程范式） ──
  let engineType: string | undefined;
  if (obj.engine === undefined) {
    errors.push({ field: "engine", message: "必填，领域采用的工程范式" });
  } else if (typeof obj.engine !== "object" || obj.engine === null || Array.isArray(obj.engine)) {
    errors.push({ field: "engine", message: "必须是对象" });
  } else {
    const engine = obj.engine as Record<string, unknown>;
    if (typeof engine.type !== "string" || !ENGINE_TYPES.includes(engine.type as "loop" | "graph")) {
      errors.push({
        field: "engine.type",
        message: `必填，必须是 ${ENGINE_TYPES.join(" | ")}`,
      });
    } else {
      engineType = engine.type;
    }
  }

  // ── agents ──
  // 提前收集 agent names，供 commands[].agent 引用校验
  const agentNames = new Set<string>();
  if (!Array.isArray(obj.agents)) {
    errors.push({ field: "agents", message: "必须是数组" });
  } else {
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

      // model（可选）
      if (a.model !== undefined && (typeof a.model !== "string" || a.model.trim() === "")) {
        errors.push({ field: `${prefix}.model`, message: "如果提供，必须是非空字符串" });
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
    const hasEntry = obj.commands.some((c: unknown) => {
      if (typeof c !== "object" || c === null) return false;
      const cmd = c as Record<string, unknown>;
      return cmd.kind === "entry";
    });

    for (let i = 0; i < obj.commands.length; i++) {
      const cmd = obj.commands[i];
      const prefix = `commands[${i}]`;

      if (typeof cmd !== "object" || cmd === null) {
        errors.push({ field: prefix, message: "必须是对象" });
        continue;
      }

      const c = cmd as Record<string, unknown>;

      // kind（engine 入口类型；与 agent 的 role 是不同 vocabulary）
      if (typeof c.kind !== "string" || !COMMAND_KINDS.includes(c.kind)) {
        errors.push({
          field: `${prefix}.kind`,
          message: `必填，必须是 ${COMMAND_KINDS.join(" | ")}`,
        });
      }

      // agent（必填，显式声明驱动哪个 worker；引用 agents[].name）
      if (typeof c.agent !== "string" || c.agent.trim() === "") {
        errors.push({ field: `${prefix}.agent`, message: "必填，必须引用已存在的 agents[].name" });
      } else if (agentNames.size > 0 && !agentNames.has(c.agent)) {
        errors.push({
          field: `${prefix}.agent`,
          message: `"${c.agent}" 在 agents 中不存在`,
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

    if (!hasEntry) {
      errors.push({ field: "commands", message: "必须至少包含一个 kind=entry 的命令" });
    }
  }

  // ── backpressure（可选） ──
  if (obj.backpressure !== undefined) {
    if (
      typeof obj.backpressure !== "object" ||
      obj.backpressure === null ||
      Array.isArray(obj.backpressure)
    ) {
      errors.push({ field: "backpressure", message: "必须是对象" });
    } else {
      const bp = obj.backpressure as Record<string, unknown>;
      if (!["test", "lint", "custom"].includes(bp.type as string)) {
        errors.push({ field: "backpressure.type", message: "必须是 test | lint | custom" });
      }
      if (typeof bp.command !== "string" || bp.command.trim() === "") {
        errors.push({ field: "backpressure.command", message: "必须是非空字符串" });
      }
      if (
        typeof bp.max_failures !== "number" ||
        !Number.isInteger(bp.max_failures) ||
        bp.max_failures < 1
      ) {
        errors.push({ field: "backpressure.max_failures", message: "必须是 >= 1 的整数" });
      }
    }
  }

  // ── tasks（图模式下必填，定义 DAG 节点） ──
  const taskIds = new Set<string>();
  if (engineType === "graph" && obj.tasks === undefined) {
    errors.push({ field: "tasks", message: "engine.type=graph 时必填，定义 DAG 任务节点" });
  } else if (obj.tasks !== undefined) {
    if (!Array.isArray(obj.tasks)) {
      errors.push({ field: "tasks", message: "必须是数组" });
    } else if (obj.tasks.length === 0) {
      errors.push({ field: "tasks", message: "至少需要 1 个任务" });
    } else {
      for (let i = 0; i < obj.tasks.length; i++) {
        const task = obj.tasks[i];
        const prefix = `tasks[${i}]`;
        if (typeof task !== "object" || task === null) {
          errors.push({ field: prefix, message: "必须是对象" });
          continue;
        }
        const t = task as Record<string, unknown>;
        if (typeof t.id !== "string" || t.id.trim() === "") {
          errors.push({ field: `${prefix}.id`, message: "必须是非空字符串" });
        } else if (taskIds.has(t.id)) {
          errors.push({ field: `${prefix}.id`, message: `任务 ID "${t.id}" 重复` });
        } else {
          taskIds.add(t.id);
        }
        if (typeof t.title !== "string" || t.title.trim() === "") {
          errors.push({ field: `${prefix}.title`, message: "必须是非空字符串" });
        }
        if (t.depends_on !== undefined) {
          if (!Array.isArray(t.depends_on)) {
            errors.push({ field: `${prefix}.depends_on`, message: "必须是数组" });
          } else {
            for (let j = 0; j < t.depends_on.length; j++) {
              if (typeof t.depends_on[j] !== "string" || t.depends_on[j].trim() === "") {
                errors.push({
                  field: `${prefix}.depends_on[${j}]`,
                  message: "必须是有效的任务 ID 字符串",
                });
              }
            }
          }
        }
      }
    }
  }

  // ── 环路检测：tasks 存在且 ID 收集完成时，检查 depends_on 引用和环路 ──
  if (obj.tasks !== undefined && Array.isArray(obj.tasks) && taskIds.size > 0) {
    // 第二遍：检查 depends_on 引用是否存在
    let hasRefError = false;
    for (let i = 0; i < (obj.tasks as unknown[]).length; i++) {
      const task = (obj.tasks as unknown[])[i] as Record<string, unknown>;
      const deps = task.depends_on as string[] | undefined;
      if (!deps) continue;
      for (let j = 0; j < deps.length; j++) {
        if (!taskIds.has(deps[j])) {
          errors.push({
            field: `tasks[${i}].depends_on[${j}]`,
            message: `"${deps[j]}" 不是有效的任务 ID`,
          });
          hasRefError = true;
        }
      }
    }
    // 仅当引用全部有效时运行 DFS 环路检测
    if (!hasRefError) {
      const adj = new Map<string, string[]>();
      for (const raw of obj.tasks as unknown[]) {
        const t = raw as Record<string, unknown>;
        adj.set(t.id as string, (t.depends_on as string[]) ?? []);
      }
      const WHITE = 0, GRAY = 1, BLACK = 2;
      const color = new Map<string, number>();
      for (const id of taskIds) color.set(id, WHITE);
      let hasCycle = false;
      function dfs(node: string): void {
        color.set(node, GRAY);
        for (const dep of adj.get(node) ?? []) {
          const c = color.get(dep);
          if (c === GRAY) { hasCycle = true; return; }
          if (c === WHITE) dfs(dep);
          if (hasCycle) return;
        }
        color.set(node, BLACK);
      }
      for (const id of taskIds) {
        if (color.get(id) === WHITE) dfs(id);
        if (hasCycle) break;
      }
      if (hasCycle) {
        errors.push({ field: "tasks", message: "检测到循环依赖：tasks 中的 depends_on 存在环路" });
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
    throw new Error(`无法读取领域文件 ${path}: ${(err as Error).message}`, { cause: err });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`领域文件 JSON 解析失败 (${path}): ${(err as Error).message}`, { cause: err });
  }

  const fieldErrors = validateDomainFields(json);
  if (fieldErrors.length > 0) {
    const msg = fieldErrors.map((e) => `  ${e.field}: ${e.message}`).join("\n");
    throw new Error(`领域文件校验失败 (${path}):\n${msg}`);
  }

  // 类型断言已通过校验
  const obj = json as Record<string, unknown>;
  const engineObj = obj.engine as Record<string, unknown>;
  const domain: ResolvedDomain = {
    id: obj.id as string,
    engine: { type: engineObj.type as "loop" | "graph" },
    agents: (obj.agents as unknown[]).map((a) => {
      const agent = a as Record<string, unknown>;
      return {
        role: agent.role as string,
        name: agent.name as string,
        description: agent.description as string,
        model: typeof agent.model === "string" && agent.model.trim() ? agent.model : undefined,
      };
    }),
    commands: (obj.commands as unknown[]).map((c) => {
      const cmd = c as Record<string, unknown>;
      return {
        kind: cmd.kind as string,
        agent: cmd.agent as string,
        name: cmd.name as string,
        description: cmd.description as string,
      };
    }),
  };

  if (
    obj.backpressure &&
    typeof obj.backpressure === "object" &&
    !Array.isArray(obj.backpressure)
  ) {
    const bp = obj.backpressure as Record<string, unknown>;
    domain.backpressure = {
      type: bp.type as "test" | "lint" | "custom",
      command: bp.command as string,
      max_failures: bp.max_failures as number,
      retry_on_failure: bp.retry_on_failure as boolean | undefined,
    };
  }

  if (Array.isArray(obj.tasks)) {
    domain.tasks = (obj.tasks as unknown[]).map((t) => {
      const task = t as Record<string, unknown>;
      return {
        id: task.id as string,
        title: task.title as string,
        depends_on: Array.isArray(task.depends_on) ? (task.depends_on as string[]) : undefined,
        accept_criteria: Array.isArray(task.accept_criteria)
          ? (task.accept_criteria as string[])
          : undefined,
      };
    });
  }

  return domain;
}
