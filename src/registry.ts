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
 * 领域差异通过模板 + domains.ts 的 description 表达；本注册表只承载"工程范式 vocabulary"。
 * 不再保留 default 通用模板路径——无 --domain 时回退到 ralph 内核范式。
 */

/** Agent 三角色的合法取值。 */
export const AGENT_ROLES = ["orchestrator", "executor", "reviewer"];

/** 领域工程范式（engine.type）的合法取值。loop = 循环工程设计，graph = 图路由工程设计。 */
export const ENGINE_TYPES: string[] = ["loop", "graph"];

/** Command kind 的合法取值。entry = engine 入口触发器。 */
export const COMMAND_KINDS: string[] = ["entry"];

/** 无 --domain 时使用的默认领域 id。ralph 是最通用的内核范式。 */
export const DEFAULT_DOMAIN_ID = "ralph";
