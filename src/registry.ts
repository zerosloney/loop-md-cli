/**
 * Agent / Engine / Command 注册表。
 *
 * 三层概念，必须分清：
 *
 *   Engine 范式（领域工程方法论）= loop
 *     → 当前唯一支持的工程范式："循环工程设计"（Loop Engineering Design）。
 *     → 表达"任务有限循环 + 背压熔断 + 完成标准收敛"的工程方法论。
 *
 *   Agent 三角色（worker 分类）= orchestrator / executor / reviewer
 *     → 是 worker 端的角色分工；orchestrator 调度，executor 干活，reviewer 把关。
 *     → 三角色协作于 engine 范式之下。
 *
 *   Command 类型（engine 入口触发器）= entry
 *     → kind=entry 是 engine 的入口命令（用户调 /code-loop 时启动一个 orchestrator 进程）。
 *     → 每个 command 必须显式声明 agent 字段（驱动哪个 worker），不再靠命名派生。
 *
 * 关系：用户 → /entry (command) → orchestrator (agent) → executor + reviewer (agents)
 *       命令显式声明：commands[].agent = "xxx-orchestrator"
 *
 * 角色/类型的具体名称与描述由领域（domains.ts）提供；
 * 无 domain 时使用角色名作为输出文件，描述用此处的默认描述。
 */

export interface AgentMeta {
  description: string;
}

export interface CommandMeta {
  description: string;
}

// ── 默认 Agent 三角色（无 domain 时使用） ──
export const AGENTS: Record<string, AgentMeta> = {
  orchestrator: {
    description: "Loop 主控 Agent。规划执行边界、委派执行者/审查者，根据真实门禁决定停止。",
  },
  executor: {
    description: "Loop 执行者 Agent。在声明边界内执行业务产出，按根因分组修改并运行真实验证。",
  },
  reviewer: {
    description: "Loop 只读质量阀。复核执行者产出与变更，输出可机器路由的 JSON verdict/issues。",
  },
};

// ── 默认 command 模板描述（kind="entry" 的默认描述） ──
// 注：模板文件命名约定保留 `loop.md` / `ralph-loop.md`（作为"为 loop 引擎写的入口"语义约定），
// 但 schema 上 commands[].kind="entry"。lookup key 用 "loop" 保持向后兼容。
export const COMMANDS: Record<string, CommandMeta> = {
  loop: {
    description: "Loop 闭环命令。规划边界、委派执行者/审查者，按完成标准决定停止。",
  },
};

export const AGENT_ROLES = Object.keys(AGENTS);

/** 领域工程范式（engine.type）的合法取值。当前仅支持 loop = 循环工程设计。 */
export const ENGINE_TYPES: string[] = ["loop"];

/** Command kind 的合法取值。entry = engine 入口触发器。 */
export const COMMAND_KINDS: string[] = ["entry"];
