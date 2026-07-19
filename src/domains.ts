/**
 * 领域注册表：将通用角色映射到领域具体文件与描述。
 *
 * 内置领域：
 *   programming → code-orchestrator / code-builder / code-reviewer / code-loop
 *   testing     → test-orchestrator / test-writer / coverage-reviewer / test-loop
 *
 * 自定义领域：通过代码扩展 DOMAINS，或在 .opencode/domains/*.json 添加。
 */

export interface Domain {
  id: string;
  agents: { role: string; name: string; description: string }[];
  commands: { role: string; name: string; description: string }[];
}

export const DOMAINS: Record<string, Domain> = {
  programming: {
    id: "programming",
    agents: [
      {
        role: "orchestrator",
        name: "code-orchestrator",
        description:
          "Code-Loop 主控 Agent。规划 scope、维护 loop 元状态、委派 code-builder/code-reviewer，并根据真实门禁决定停止。",
      },
      {
        role: "executor",
        name: "code-builder",
        description:
          "受控编码与修复的 Builder Agent。只在声明 scope 内改代码，按根因分组修复，运行真实验证并把失败原样交回 Orchestrator。",
      },
      {
        role: "reviewer",
        name: "code-reviewer",
        description:
          "只读审查 Agent。基于本轮 diff、scope baseline 和真实验证结果做语义审查，输出可机器路由的 JSON verdict/issues。按 Orchestrator 注入的 risk_level 自动加强到高风险协议。",
      },
    ],
    commands: [
      {
        role: "loop",
        name: "code-loop",
        description:
          "Builder/Reviewer 编码闭环。用 scope、baseline、真实验证和有限轮次收敛代码修改。",
      },
    ],
  },
  testing: {
    id: "testing",
    agents: [
      {
        role: "orchestrator",
        name: "test-orchestrator",
        description:
          "Test-Loop 主控 Agent。规划测试 scope、维护 loop 元状态、委派 test-writer/coverage-reviewer，并基于覆盖率、变异分数、无效测试与 Reviewer verdict 决定停止。绝不修改被测源码。",
      },
      {
        role: "executor",
        name: "test-writer",
        description:
          "Test-Loop 中唯一可以编写测试代码的执行者。只在声明 scope 内写测试（hard_scope），运行 test/coverage/变异真实验证，绝不修改被测源码。",
      },
      {
        role: "reviewer",
        name: "coverage-reviewer",
        description:
          "Test-Loop 的只读质量阀。基于本轮 diff、scope baseline 和真实验证结果（覆盖率/变异/无效测试）做语义审查，输出可机器路由的 JSON verdict/issues。绝不修改任何代码（测试或被测源码）。",
      },
    ],
    commands: [
      {
        role: "loop",
        name: "test-loop",
        description:
          "Test-Writer/Coverage-Reviewer 测试闭环。用 scope、baseline、覆盖率/变异真实验证和有限轮次收敛测试编写；绝不修改被测源码。",
      },
    ],
  },
};