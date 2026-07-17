/**
 * Agent / Command 注册表。
 * 每项声明 description（渲染到目标平台 frontmatter）；正文与 permission 来自 agents/*.md、commands/*.md。
 */

export interface AgentMeta {
  description: string;
}

export interface CommandMeta {
  description: string;
}

export const AGENTS: Record<string, AgentMeta> = {
  "code-orchestrator": {
    description:
      "Code-Loop 主控 Agent。规划 scope、维护 loop 元状态、委派 code-builder/code-reviewer，并根据真实门禁决定停止。",
  },
  "code-builder": {
    description:
      "受控编码与修复的 Builder Agent。只在声明 scope 内改代码，按根因分组修复，运行真实验证并把失败原样交回 Orchestrator。",
  },
  "code-reviewer": {
    description:
      "只读审查 Agent。基于本轮 diff、scope baseline 和真实验证结果做语义审查，输出可机器路由的 JSON verdict/issues。按 Orchestrator 注入的 risk_level 自动加强到高风险协议。",
  },
  "test-orchestrator": {
    description:
      "Test-Loop 主控 Agent。规划测试 scope、维护 loop 元状态、委派 test-writer/coverage-reviewer，并基于覆盖率、变异分数、无效测试与 Reviewer verdict 决定停止。绝不修改被测源码。",
  },
  "test-writer": {
    description:
      "Test-Loop 中唯一可以编写测试代码的执行者。只在声明 scope 内写测试（hard_scope），运行 test/coverage/变异真实验证，绝不修改被测源码。",
  },
  "coverage-reviewer": {
    description:
      "Test-Loop 的只读质量阀。基于本轮 diff、scope baseline 和真实验证结果（覆盖率/变异/无效测试）做语义审查，输出可机器路由的 JSON verdict/issues。绝不修改任何代码（测试或被测源码）。",
  },
};

export const COMMANDS: Record<string, CommandMeta> = {
  "code-loop": {
    description:
      "Builder/Reviewer 编码闭环。用 scope、baseline、真实验证和有限轮次收敛代码修改。",
  },
  "test-loop": {
    description:
      "Test-Writer/Coverage-Reviewer 测试闭环。用 scope、baseline、覆盖率/变异真实验证和有限轮次收敛测试编写；绝不修改被测源码。",
  },
};
