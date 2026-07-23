# loop-md-cli

> 从单一源生成多平台 AI 编码 agent/command 配置的脚手架。一次编写模板，到处部署。

> 中文 | [English](./README.md)

## 快速上手

```bash
npx @master0071/loop-md-cli --list           # 确认能跑通，看到 7 个平台
npx @master0071/loop-md-cli --all            # 默认 ralph 范式，生成 .claude/ .opencode/ 等目录
npx @master0071/loop-md-cli --validate --all # 退出码 0 即所有平台配置与模板一致
```

需要 Node.js >= 18，零运行时依赖。

## 基本用法

```bash
loop-md-cli --all                          # 所有平台
loop-md-cli --claude --opencode            # 指定平台
loop-md-cli --claude --domain coding       # 指定领域
loop-md-cli --all --dry-run                # 演练，不写入文件
loop-md-cli --validate --all               # 验证一致性
loop-md-cli --watch --claude               # 监听文件变化
loop-md-cli --incremental --all            # 仅更新变化文件
loop-md-cli --archive configs.zip --all    # 导出 ZIP
loop-md-cli --trae --domain coding \       # 指定各角色子 agent 模型
  --model-orchestrator "DeepSeek-V4-Pro" \
  --model-executor "DeepSeek-V4-Flash" \
  --model-reviewer "Doubao_1_6"
```

## 为什么需要它？

7 个 AI 编程平台的 agent 配置格式各不相同，手动维护重复劳动且易遗漏：

| 平台        | 输出目录      | frontmatter 特征                                                                | 工具名格式       |
| ----------- | ------------- | ------------------------------------------------------------------------------- | ---------------- |
| Claude Code | `.claude/`    | `name` + `description` + `tools`                                                | PascalCase       |
| OpenCode    | `.opencode/`  | `description` + `mode` + `steps` + `permission`                                 | snake_case       |
| Kilo Code   | `.kilo/`      | 同 OpenCode                                                                     | snake_case       |
| Trae IDE    | `.trae/`      | `name` + `description` + `tools`                                                | 小写 + camelCase |
| CodeBuddy   | `.codebuddy/` | `name` + `description` + `model:inherit` + `tools` + `permissionMode`           | PascalCase       |
| Qwen Code   | `.qwen/`      | `name` + `description` + `model` + `tools` + `disallowedTools` + `approvalMode` | PascalCase       |
| Qoder       | `.qoder/`     | 同 Claude                                                                       | PascalCase       |

> 所有平台均支持按角色指定子 agent 模型，通过 `--model-orchestrator/executor/reviewer` 参数传入，不指定时子 agent 继承主会话模型。

loop-md-cli 通过 **模板 + 领域 + 渲染器** 三层抽象解决这个问题。

## 领域化生成

内置 5 个领域，每个有专属模板 enforce 各自工程纪律：

| 领域      | Agent 名称                                        | 命令               | 领域铁律                                                                         |
| --------- | -------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------- |
| `ralph`   | ralph-orchestrator / worker / reviewer             | ralph-loop / ralph-graph | **内核范式**：TaskList 驱动 + 背压熔断（loop）；DAG 路由 + 激活集执行（graph）。最通用，自定义领域无专属模板时回退到此 |
| `graph`   | graph-orchestrator / graph-worker / graph-reviewer | ralph-graph        | **图路由范式**：DAG 拓扑路由，内置示例任务图（t1→t2/t3→t4）。可基于此定制自定义 DAG 领域 |
| `coding`  | coding-orchestrator / builder / reviewer           | coding-loop        | scope 铁律 + 根因分组修复 + scope drift 零容忍                                   |
| `testing` | test-orchestrator / writer / coverage-reviewer     | test-loop          | 源码冻结 + 三项信号（coverage ≥ 80% / mutation ≥ 60% / empty-assertion = 0）     |
| `writing` | writing-orchestrator / author / reviewer           | writing-loop       | 写作边界 + 三项信号（术语漂移 / 死链 / 代码示例）                                |

```bash
loop-md-cli --opencode --domain coding
loop-md-cli --opencode --domain testing --dry-run
```

> `ralph` 是内核范式，`coding/testing/writing` 是基于 ralph 的领域特化。backpressure 是通用内核能力，`coding/testing` 沿用强门禁（`npm test`），`writing` 用弱门禁（`npm run lint`）。

### 自定义领域

通过 `--domain-file` 传入自定义 JSON，或放在 `.opencode/domains/<id>.json` 自动发现：

```bash
loop-md-cli --opencode --domain-file ./my-domain.json
loop-md-cli --claude --domain my-domain   # 自动扫描 .opencode/domains/
```

JSON 格式要求 `engine: { type: "loop" }`（默认）或 `engine: { type: "graph" }`。`"graph"` 类型额外需要 `tasks` 数组定义 DAG（见下方）。每个 command 必填 `kind: "entry"` 和 `agent`。

### Graph 引擎

内置 `graph` 领域开箱即用（`--domain graph`）；下方示例展示如何定义**自定义** graph 领域及自己的任务 DAG：

```json
{
  "id": "my-graph",
  "engine": { "type": "graph" },
  "agents": [
    { "role": "orchestrator", "name": "my-orchestrator" },
    { "role": "executor",     "name": "my-worker" },
    { "role": "reviewer",     "name": "my-reviewer" }
  ],
  "commands": [
    { "kind": "entry", "agent": "my-orchestrator", "name": "my-graph" }
  ],
  "tasks": [
    { "id": "t1", "title": "初始化",   "depends_on": [] },
    { "id": "t2", "title": "构建",     "depends_on": ["t1"] },
    { "id": "t3", "title": "测试",     "depends_on": ["t2"] },
    { "id": "t4", "title": "部署",     "depends_on": ["t2"] }
  ]
}
```

`tasks` 数组定义了一个 DAG，每个任务包含 `id`、`title` 和可选的 `depends_on`（任务 ID 数组）。CLI 会计算拓扑排序并将 `routing_table` 注入生成的命令模板，使主控 Agent 能够并行执行独立任务。

```bash
loop-md-cli --opencode --domain-file ./my-graph-domain.json
```

> `ralph` 是内核范式，`coding/testing/writing` 是基于 ralph 的领域特化。backpressure 是通用内核能力，`coding/testing` 沿用强门禁（`npm test`），`writing` 用弱门禁（`npm run lint`）。

## 自定义模板

### 三级回退

渲染 `<domain>-<role>` 时按顺序查找：

1. `<domain>-<role>.md`（如 `my-domain-orchestrator.md`）— 领域专属
2. `ralph-<role>.md` — 最通用内核范式
3. 抛错（避免静默生成 0 文件）

自定义领域至少能跑（回退到 ralph），要做领域特化需提供专属模板。

### 模板格式

```markdown
---
name: { { name } }
description: { { description } }
mode: subagent
temperature: 0.2
steps: 30
permission:
  edit: allow
  bash:
    "*": allow
---

## 角色

你是 **{{name}}**，Loop 执行者 Agent。
```

### 占位符

| 占位符             | 来源                               | 适用            |
| ------------------ | ---------------------------------- | --------------- |
| `{{name}}`         | 领域定义的 agent/command 名称      | agent           |
| `{{description}}`  | 领域定义的描述                     | agent + command |
| `{{agent}}`        | 对应 loop 关联的 orchestrator 名称 | command         |
| `{{backpressure}}` | 领域的背压熔断配置                 | orchestrator    |
| `{{engine_type}}`  | 领域定义的 `engine.type`           | agent           |
| `{{executor_name}}`| 执行者 agent 名（按 role 从领域查找）| command        |
| `{{reviewer_name}}`| 审查者 agent 名（按 role 从领域查找）| command        |
| `{{routing_table}}`| DAG 拓扑排序 + 入口节点（graph）   | command (graph)  |

### 内置领域模板

| 领域      | 模板文件                                                                                      | 纪律                  |
| --------- | --------------------------------------------------------------------------------------------- | --------------------- |
| `ralph`   | `ralph-orchestrator.md` / `ralph-worker.md` / `ralph-reviewer.md` / `ralph-loop.md` / `ralph-graph.md` | TaskList + 背压熔断（loop）；DAG 路由 + 激活集（graph） |
| `coding`  | `coding-orchestrator.md` / `coding-executor.md` / `coding-reviewer.md` / `coding-loop.md`     | scope 铁律 + 根因分组 |
| `testing` | `testing-orchestrator.md` / `testing-executor.md` / `testing-reviewer.md` / `testing-loop.md` | 源码冻结 + 三项信号   |
| `writing` | `writing-orchestrator.md` / `writing-executor.md` / `writing-reviewer.md` / `writing-loop.md` | 写作边界 + 三项信号   |

## 支持的平台

| 平台        | CLI 标志      | 输出目录      | 渲染族    |
| ----------- | ------------- | ------------- | --------- |
| Claude Code | `--claude`    | `.claude/`    | named     |
| Qoder       | `--qoder`     | `.qoder/`     | named     |
| Qwen Code   | `--qwen`      | `.qwen/`      | qwen      |
| OpenCode    | `--opencode`  | `.opencode/`  | mode      |
| Kilo Code   | `--kilo`      | `.kilo/`      | mode      |
| CodeBuddy   | `--codebuddy` | `.codebuddy/` | codebuddy |
| Trae IDE    | `--trae`      | `.trae/`      | trae      |

## 输出示例

同一份 ralph 领域模板，经不同渲染族产出的 frontmatter 各不相同。下面均为 `loop-md-cli --all` 的真实输出（为简洁略有节选）。

**named 族**（Claude Code / Qoder）— `.claude/agents/ralph-reviewer.md`：

```markdown
---
name: ralph-reviewer
description: Ralph Loop 审查者。只读质量阀，输出可机器路由的 verdict/issues。
tools: Read, Grep, Glob, Bash
---
```

**mode 族**（OpenCode / Kilo）— `.opencode/agents/ralph-orchestrator.md`（节选）：

```markdown
---
description: Ralph Loop 主控 Agent。维护任务列表、委派执行者/审查者，根据门禁决定停止。
mode: subagent
temperature: 0.3
steps: 30
permission:
  edit: deny
  bash:
    "*": deny
    "test *": allow
  read: allow
---
```

**codebuddy 族** — `.codebuddy/agents/ralph-orchestrator.md`：

```markdown
---
name: ralph-orchestrator
description: Ralph Loop 主控 Agent。维护任务列表、委派执行者/审查者，根据门禁决定停止。
model: inherit
permissionMode: default
---
```

**trae 族** — `.trae/agents/ralph-reviewer.md`：

```markdown
---
name: ralph-reviewer
description: Ralph Loop 审查者。只读质量阀，输出可机器路由的 verdict/issues。
tools: Read, Grep, Glob
---
```

**qwen 族** — `.qwen/agents/ralph-reviewer.md`：

```markdown
---
name: ralph-reviewer
description: Ralph Loop 审查者。只读质量阀，输出可机器路由的 verdict/issues。
tools: Read, Grep, Glob, Bash
disallowedTools: [Write, Edit]
approvalMode: plan
---
```

> 注意 qwen 族的 `disallowedTools: [Write, Edit]` 是 YAML 流序列（数组），渲染时**不能**加引号，否则会被解析成字符串。含 `: `、` #` 等危险字符的自由文本字段（name/description/model）才会自动加引号转义。

## 完整 CLI 参考

| 选项                   | 简写        | 说明                                                               |
| ---------------------- | ----------- | ------------------------------------------------------------------ |
| `--help`               | `-h`        | 显示帮助信息                                                       |
| `--version`            | `-V` / `-v` | 显示版本号                                                         |
| `--validate`           | —           | 验证平台配置与模板一致性                                           |
| `--watch`              | `-w`        | 监听文件变化，自动重新生成                                         |
| `--incremental`        | `-i`        | 增量生成（仅更新变化文件）                                         |
| `--archive`            | `-o`        | 导出为 ZIP 压缩包                                                  |
| `--all`                | `-a`        | 生成/验证/导出所有平台                                             |
| `--list`               | `-l`        | 列出支持的平台                                                     |
| `--dry-run`            | `-n`        | 演练模式，不实际写入                                               |
| `--domain`             | `-d`        | 使用指定领域                                                       |
| `--domain-file`        | `-D`        | 自定义领域文件路径                                                 |
| `--model-orchestrator` | —           | 编排者子 agent 模型（如 `--model-orchestrator "DeepSeek-V4-Pro"`） |
| `--model-executor`     | —           | 执行者子 agent 模型                                                |
| `--model-reviewer`     | —           | 审查者子 agent 模型                                                |

## 贡献

见 [CONTRIBUTING.md](./CONTRIBUTING.md)。变更历史见 [CHANGELOG.md](./CHANGELOG.md)，架构设计见 [docs/architecture.md](./docs/architecture.md)。

## License

MIT
