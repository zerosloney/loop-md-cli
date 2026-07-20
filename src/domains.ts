/**
 * 领域注册表：将通用工程范式（engine）+ 三角色 + 命令入口，映射到领域具体文件与描述。
 *
 * 内置领域（全部采用 loop 引擎范式，每个领域都有专属模板 enforce 各自纪律）：
 *   ralph       → ralph-orchestrator / ralph-worker / ralph-reviewer / ralph-loop
 *                 内核范式：TaskList + 背压熔断（最通用，自定义领域无专属模板时回退到此）
 *   programming → code-orchestrator / code-builder / code-reviewer / code-loop
 *                 编程领域：scope 铁律（hard/soft/forbidden）+ 根因分组修复 + scope drift 零容忍
 *   testing     → test-orchestrator / test-writer / coverage-reviewer / test-loop
 *                 测试领域：源码冻结铁律 + 三项信号（coverage/mutation/empty-assertion）
 *   writing     → writing-orchestrator / writing-author / writing-reviewer / writing-loop
 *                 写作领域：写作边界铁律 + 三项信号（术语/链接/示例）+ 弱门禁
 *
 * backpressure（断路器）是通用内核能力，所有内置领域默认携带：
 *   programming / testing / ralph → npm test, max_failures=3
 *   writing                      → npm run lint, max_failures=2（弱门禁）
 *
 * 每个 command 必填 agent 字段，显式声明驱动哪个 worker（告别按 -loop 后缀硬拆）。
 *
 * 自定义领域：通过 .opencode/domains/*.json 自动扫描，或通过 --domain-file 传入 JSON。
 * 无 --domain 时回退到 ralph 内核范式。
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
          "Code-Loop 主控 Agent。规划 scope、维护 loop 元状态、委派 code-builder/code-reviewer。铁律：scope drift 零容忍 + 按根因分组委派修复。按真实门禁决定停止。",
      },
      {
        role: "executor",
        name: "code-builder",
        description:
          "受控编码与修复的 Builder Agent。只在 hard_scope 内改代码，按根因分组修复（禁止逐条补丁），运行真实验证，把失败原样交回 Orchestrator。",
      },
      {
        role: "reviewer",
        name: "code-reviewer",
        description:
          "只读审查 Agent。基于本轮 diff、scope baseline 和真实验证做语义审查 + scope drift 检测，输出可机器路由的 JSON verdict/issues。issues 必须按根因归并，方便 executor 一组一次修。",
      },
    ],
    commands: [
      {
        kind: "entry",
        agent: "code-orchestrator",
        name: "code-loop",
        description:
          "Builder/Reviewer 编码闭环。用 scope、baseline、真实验证和有限轮次收敛代码修改；scope drift 零容忍 + 根因分组修复。",
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
          "Test-Loop 主控 Agent。维护 TaskList、委派 test-writer/coverage-reviewer。第一铁律：源码冻结（绝不修改被测源码）。完成判据：覆盖率/变异分数/无效测试三项信号全部达标。",
      },
      {
        role: "executor",
        name: "test-writer",
        description:
          "Test-Loop 中唯一可以编写测试代码的执行者。第一铁律：源码冻结（被测源码一行都不碰）。每轮跑 test/coverage/mutation 三项验证，无效断言（empty assertion）零容忍。",
      },
      {
        role: "reviewer",
        name: "coverage-reviewer",
        description:
          "Test-Loop 的只读质量阀。独立判定三项信号（coverage.lines >= 80%、mutation_score >= 60%、empty_assertions_count == 0）+ 源码冻结双保险，输出 JSON verdict/issues。绝不修改任何代码（测试或被测源码）。",
      },
    ],
    commands: [
      {
        kind: "entry",
        agent: "test-orchestrator",
        name: "test-loop",
        description:
          "Test-Writer/Coverage-Reviewer 测试闭环。TaskList 驱动 + 三项信号（覆盖率/变异/无效测试）+ 源码冻结铁律 + 背压熔断。绝不修改被测源码。",
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
          "Writing-Loop 主控 Agent。维护 TaskList、委派 writing-author/writing-reviewer。完成判据：三项写作质量信号（术语漂移/死链/代码示例错误）全部达标。写作边界严格限定文档目录，源码/配置/CI 禁碰。",
      },
      {
        role: "executor",
        name: "writing-author",
        description:
          "Writing-Loop 执行者 Agent。只在文档目录（hard_scope）内写文档，按术语表保证一致性，保证链接可达、代码示例有效。源码/配置/CI 禁碰。",
      },
      {
        role: "reviewer",
        name: "writing-reviewer",
        description:
          "Writing-Loop 只读质量阀。独立判定三项信号（terminology_drift_count == 0、broken_links_count == 0、code_example_errors == 0）+ 写作边界双保险，输出 JSON verdict/issues。绝不修改任何文件。",
      },
    ],
    commands: [
      {
        kind: "entry",
        agent: "writing-orchestrator",
        name: "writing-loop",
        description:
          "Writing-Loop 文档写作闭环。TaskList 驱动 + 三项写作质量信号（术语/链接/示例）+ 写作边界铁律 + 弱门禁背压（lint 不重试）。",
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
