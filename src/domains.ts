/**
 * 领域注册表：将通用工程范式（engine）+ 三角色 + 命令入口，映射到领域具体文件与描述。
 *
 * 内置领域（全部采用 loop 引擎范式）：
 *   programming → code-orchestrator / code-builder / code-reviewer / code-loop (→code-orchestrator)
 *   testing     → test-orchestrator / test-writer / coverage-reviewer / test-loop (→test-orchestrator)
 *   writing     → writing-orchestrator / writing-author / writing-reviewer / writing-loop (→writing-orchestrator)
 *   ralph       → ralph-orchestrator / ralph-worker / ralph-reviewer / ralph-loop (→ralph-orchestrator)
 *
 * ralph 是内核范式（任务列表驱动 + 背压熔断），有自己的专属模板
 * （src/templates/agents/ralph-*.md / src/templates/commands/ralph-loop.md）；
 * programming/testing/writing 基于 ralph 内核演化为特定领域，使用通用模板。
 *
 * backpressure（断路器）是通用内核能力，所有内置领域默认携带：
 *   programming / testing / ralph → npm test, max_failures=3
 *   writing                      → npm run lint, max_failures=2（弱门禁）
 *
 * 每个 command 必填 agent 字段，显式声明驱动哪个 worker（告别按 -loop 后缀硬拆）。
 *
 * 自定义领域：通过代码扩展 DOMAINS，或通过 --domain-file 传入 JSON。
 */

import type { BackpressureConfig, EngineConfig } from "./domain-schema.js";

export interface Domain {
  id: string;
  engine: EngineConfig;
  agents: { role: string; name: string; description: string }[];
  commands: { kind: string; agent: string; name: string; description: string }[];
  backpressure?: BackpressureConfig;
}

const LOOP_ENGINE: EngineConfig = { type: "loop" };

export const DOMAINS: Record<string, Domain> = {
  programming: {
    id: "programming",
    engine: LOOP_ENGINE,
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
        kind: "entry",
        agent: "code-orchestrator",
        name: "code-loop",
        description:
          "Builder/Reviewer 编码闭环。用 scope、baseline、真实验证和有限轮次收敛代码修改。",
      },
    ],
    backpressure: {
      type: "test",
      command: "npm test",
      max_failures: 3,
      retry_on_failure: true,
    },
  },
  testing: {
    id: "testing",
    engine: LOOP_ENGINE,
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
        kind: "entry",
        agent: "test-orchestrator",
        name: "test-loop",
        description:
          "Test-Writer/Coverage-Reviewer 测试闭环。用 scope、baseline、覆盖率/变异真实验证和有限轮次收敛测试编写；绝不修改被测源码。",
      },
    ],
    backpressure: {
      type: "test",
      command: "npm test",
      max_failures: 3,
      retry_on_failure: true,
    },
  },
  writing: {
    id: "writing",
    engine: LOOP_ENGINE,
    agents: [
      {
        role: "orchestrator",
        name: "writing-orchestrator",
        description:
          "Writing-Loop 主控 Agent。规划写作边界、维护 loop 元状态、委派 writing-author/writing-reviewer，并根据质量门禁决定停止。",
      },
      {
        role: "executor",
        name: "writing-author",
        description:
          "Writing-Loop 执行者 Agent。只在声明边界内执行业务产出。",
      },
      {
        role: "reviewer",
        name: "writing-reviewer",
        description:
          "Writing-Loop 只读质量阀。基于本轮变更做语义审查，输出 JSON verdict/issues。",
      },
    ],
    commands: [
      {
        kind: "entry",
        agent: "writing-orchestrator",
        name: "writing-loop",
        description:
          "Writing-Loop 闭环。用 scope、baseline 和有限轮次收敛写作产出。",
      },
    ],
    backpressure: {
      type: "lint",
      command: "npm run lint",
      max_failures: 2,
      retry_on_failure: false,
    },
  },
  ralph: {
    id: "ralph",
    engine: LOOP_ENGINE,
    agents: [
      {
        role: "orchestrator",
        name: "ralph-orchestrator",
        description:
          "Ralph Loop 主控 Agent。维护任务列表、委派执行者/审查者，根据门禁决定停止。",
      },
      {
        role: "executor",
        name: "ralph-worker",
        description:
          "Ralph Loop 执行者。在声明边界内逐个完成任务，运行验证，提交变更。",
      },
      {
        role: "reviewer",
        name: "ralph-reviewer",
        description:
          "Ralph Loop 审查者。只读质量阀，输出可机器路由的 verdict/issues。",
      },
    ],
    commands: [
      {
        kind: "entry",
        agent: "ralph-orchestrator",
        name: "ralph-loop",
        description:
          "Ralph Loop 闭环命令。规划边界、委派执行者/审查者，按完成标准决定停止。",
      },
    ],
    backpressure: {
      type: "test",
      command: "npm test",
      max_failures: 3,
      retry_on_failure: true,
    },
  },
};
