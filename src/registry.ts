/**
 * Agent / Command 角色注册表。
 *
 * 通用角色：
 *   orchestrator / executor / reviewer / loop
 *
 * 角色的具体名称/描述由领域（domains.ts）提供；
 * 无 domain 时使用角色名作为输出文件，描述用此处的默认描述。
 */

export interface AgentMeta {
  description: string;
}

export interface CommandMeta {
  description: string;
}

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

export const COMMANDS: Record<string, CommandMeta> = {
  loop: {
    description: "Loop 闭环命令。规划边界、委派执行者/审查者，按完成标准决定停止。",
  },
};

export const AGENT_ROLES = Object.keys(AGENTS);
export const COMMAND_ROLES = Object.keys(COMMANDS);