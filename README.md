# loop-forge

> 从单一源生成多平台 AI 编码 agent/command 配置的脚手架（Code-Loop / Test-Loop / Writing-Loop / Ralph-Loop）。

loop-forge 让你**一次编写模板，到处部署**——将统一的 agent/command 定义自动转换为 7 种主流 AI 编程平台的格式，包括 `.md` 前缀的 frontmatter、工具白名单、权限模式等差异，全部自动适配。

## 为什么需要它？

不同的 AI 编程平台（Claude Code、OpenCode、Trae、CodeBuddy ……）对 agent 和 command 的配置格式各不相同：

| 平台 | frontmatter 字段 | 工具名格式 | 权限模型 |
|------|-----------------|-----------|---------|
| Claude Code | `name` + `description` + `tools` | PascalCase | 无 |
| OpenCode | `description` + `mode` + `temperature` + `steps` + `permission` | snake_case | 细粒度 |
| Trae IDE | `name` + `description` + `tools` | 大写 | 无 |
| CodeBuddy | `name` + `description` + `model:inherit` + `tools` + `permissionMode` | PascalCase | plan/acceptEdits |

手动维护 7 份配置不仅重复劳动，还容易遗漏。loop-forge 通过 **模板 + 领域 + 渲染器** 三层抽象，彻底解决这个问题。

## 快速开始

### 安装

```bash
npm install -g loop-forge
```

或直接使用：

```bash
npx loop-forge --help
```

> 需要 Node.js >= 18。零运行时依赖，仅依赖 TypeScript 编译输出。

### 基本用法

```bash
# 生成所有平台
loop-forge --all

# 生成指定平台
loop-forge --claude --opencode --trae

# 交互式选择平台（TTY 环境）
loop-forge

# 列出支持的平台
loop-forge --list
```

### 领域化生成

使用内置领域生成领域特定的 agent 名称和描述：

```bash
# 使用编程领域
loop-forge --opencode --domain programming

# 使用测试领域
loop-forge --claude --domain testing

# 使用写作领域
loop-forge --claude --domain writing

# 使用 ralph 领域（带 backpressure 断路器）
loop-forge --claude --domain ralph
```

内置领域一览：

| 领域 ID | Agent 名称 | 命令名称 | backpressure | 说明 |
|---------|-----------|---------|--------------|------|
| `ralph` | ralph-orchestrator / ralph-worker / ralph-reviewer | ralph-loop | `npm test` / max=3 / 重试 | **内核范式**：任务列表驱动 + 背压熔断 |
| `programming` | code-orchestrator / code-builder / code-reviewer | code-loop | `npm test` / max=3 / 重试 | 基于 ralph 内核的编程领域特化（scope/baseline 驱动） |
| `testing` | test-orchestrator / test-writer / coverage-reviewer | test-loop | `npm test` / max=3 / 重试 | 基于 ralph 内核的测试领域特化 |
| `writing` | writing-orchestrator / writing-author / writing-reviewer | writing-loop | `npm run lint` / max=2 / 不重试 | 基于 ralph 内核的写作领域特化（弱门禁） |

> **架构定位**：`ralph` 是 loop-forge 的内核范式——**任务列表（TaskList）驱动 + 背压熔断（backpressure circuit breaker）**。
> 它有专属模板（`src/templates/agents/ralph-*.md`），与 programming/testing 的 scope/baseline 范式在结构上明显区分。
> `backpressure`（断路器）是通用内核能力，所有内置领域默认携带；`programming` / `testing` 沿用强门禁（`npm test`），`writing` 用弱门禁（`npm run lint`）。

### 概念分层：Engine 三层架构

> **重要区分**：`loop` **不是**与 `orchestrator / executor / reviewer` 平级的"第四个角色"，而是"循环工程设计"这种**领域工程范式**的标识。
>
> 领域 schema 分三层，对应三种不同的工程概念：
>
> | 层级 | 字段 | 取值 | 含义 |
> |------|------|------|------|
> | Engine 层 | `engine.type` | `"loop"` | 领域采用的工程范式（当前唯一支持"循环工程设计"） |
> | Agent 层 | `agents[].role` | `orchestrator / executor / reviewer` | 三角色 worker 分类 |
> | Command 层 | `commands[].kind` | `"entry"` | engine 入口触发器；`commands[].agent` 必填，显式声明驱动哪个 worker |
>
> 协作链路：用户 → `/entry` (command) → `commands[].agent` 引用的 orchestrator → executor + reviewer
>
> 关键约束：
> - 每个领域必填 `engine: { type: "loop" }`（明确"我们用循环工程设计"）
> - 每个 command 必填 `agent` 字段（告别按 `-loop` 后缀硬拆；命令名与 agent 名解耦）
> - 模板里的 `{{agent}}` 占位符直接绑定 `command.agent` 的值

### 自定义领域

通过 `--domain-file` 传入自定义领域 JSON 文件：

```json
{
  "id": "my-domain",
  "engine": { "type": "loop" },
  "agents": [
    {
      "role": "orchestrator",
      "name": "my-orchestrator",
      "description": "主控 Agent..."
    },
    {
      "role": "executor",
      "name": "my-worker",
      "description": "执行者..."
    },
    {
      "role": "reviewer",
      "name": "my-reviewer",
      "description": "审查者..."
    }
  ],
  "commands": [
    {
      "kind": "entry",
      "agent": "my-orchestrator",
      "name": "my-loop",
      "description": "闭环命令..."
    }
  ]
}
```

通过 `--domain-file` 传入：

```bash
loop-forge --opencode --domain-file ./my-domain.json
```

### 演练模式

不实际写入文件，仅打印将要生成的内容：

```bash
loop-forge --all --dry-run
```

### 验证模式

检查现有平台配置与模板的一致性，检测过期、缺失、多余的文件：

```bash
# 验证单个平台
loop-forge --validate --claude

# 验证所有平台
loop-forge --validate --all

# 验证指定领域
loop-forge --validate --claude -d programming

# 退出码：0 = 一致，1 = 发现问题
```

验证报告三类问题：

| 类型 | 含义 | 图标 |
|------|------|------|
| `stale` | 文件存在但内容不一致（被手动修改过） | ❌ |
| `missing` | 预期存在但磁盘上没有 | ❌ |
| `extra` | 磁盘上有但预期中无此文件 | ⚠️ |

### 监听模式

自动监听模板和领域文件变化，修改后重新生成：

```bash
# 监听单个平台
loop-forge --watch --claude

# 监听所有平台
loop-forge --watch --all

# 监听 + 指定领域
loop-forge --watch --claude -d writing

# 按 Ctrl+C 退出
```

### 增量生成

仅重写内容发生变化的文件，跳过未修改的文件：

```bash
# 增量生成所有平台
loop-forge --incremental --all

# 增量生成 + 指定领域
loop-forge --incremental --claude -d programming
```

首次运行等同于全量生成。之后若模板或领域未变，输出 `+0 更新`：

```
生成 1 个平台 (增量): claude
[claude] .claude/ → agents/3 commands/1 (+0 更新)
```

### 导出 ZIP

将所有平台配置打包为 ZIP 压缩包，方便分发：

```bash
# 导出所有平台
loop-forge --archive configs.zip --all

# 导出指定平台
loop-forge --archive claude-only.zip --claude

# 导出 + 指定领域
loop-forge --archive writing-config.zip --all -d writing

# 自动补 .zip 扩展名
loop-forge --archive configs --all
```


## 架构概览

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  模板 (templates/)  │  →  │  领域 (domains/)  │  →  │  渲染器 (render/)  │
│  orchestrator.md │     │  programming    │     │  NamedRenderer  │
│  executor.md     │     │  testing        │     │  ModeRenderer   │
│  reviewer.md     │     │  自定义 .json   │     │  CodeBuddyRenderer│
│  loop.md         │     └──────────────┘     │  TraeRenderer   │
└──────────────┘                              └──────────────┘
                                                    │
                                    ┌───────────────┼───────────────┐
                                    ▼               ▼               ▼
                              .claude/        .opencode/        .trae/
                              .omp/           .kilo/            .codebuddy/
                              .qoder/
```

### 三层抽象

1. **模板层** — 定义 agent/command 的 frontmatter 和正文内容，使用 `{{key}}` 占位符。
2. **领域层** — 将通用角色（orchestrator/executor/reviewer/loop）映射为领域具体的名称和描述。
3. **渲染器层** — 根据目标平台所属的"族"，将通用格式转换为平台特定格式。

### 平台族

| 族 | 平台 | frontmatter 特征 |
|----|------|-----------------|
| `named` | claude, omp, qoder | `name` + `description` + `tools`（白名单） |
| `mode` | opencode, kilo | `description` + `mode` + `temperature` + `steps` + `permission` |
| `codebuddy` | codebuddy | `name` + `description` + `model:inherit` + `tools` + `permissionMode` |
| `trae` | trae | `name` + `description` + `tools`（大写工具名） |

## 自定义模板

loop-forge 会从两个位置加载模板：

1. **包内置模板** — `src/templates/agents/` 和 `src/templates/commands/`
2. **用户自定义模板** — 项目根目录下的 `.opencode/templates/agents/` 和 `.opencode/templates/commands/`

用户自定义模板会覆盖内置模板（同名文件优先）。

### 模板格式

模板文件使用 Markdown 格式，以 YAML frontmatter 包裹元数据：

````markdown
---
name: {{name}}
description: {{description}}
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

职责：
- 只在声明边界内执行业务产出。
- 按根因分组修改，运行真实验证。
````

可用的占位符：

| 占位符 | 来源 | 适用模板 |
|--------|------|---------|
| `{{name}}` | 领域定义的 agent/command 名称 | agent |
| `{{description}}` | 领域定义的描述 | agent + command |
| `{{agent}}` | 对应 loop 关联的 orchestrator 名称 | command |

## 权限模型

loop-forge 为不同角色预定义了工具白名单和权限模式：

### 角色 → 工具映射

| 角色 | 工具白名单 | 说明 |
|------|-----------|------|
| `reviewer`（code-reviewer / coverage-reviewer） | Read, Grep, Glob, Bash | 只读审查 |
| `executor`（code-builder / test-writer） | 继承全部 | 可写可执行 |
| `orchestrator` | 继承全部 | 主控调度 |

### 角色 → permissionMode（CodeBuddy）

| 角色 | permissionMode |
|------|---------------|
| reviewer | `plan` |
| executor | `acceptEdits` |
| orchestrator | `default` |

## 开发

### 本地开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 运行测试
npm test

# 开发模式（tsx 热重载）
npm run dev -- --all
```

### 添加新平台

1. 在 `src/platforms.ts` 的 `PLATFORMS` 对象中添加一行：

```typescript
myeditor: { id: "myeditor", dir: ".myeditor", family: "named", note: "My Editor" },
```

2. 如需新的渲染族，在 `src/render/` 下创建新的 Renderer 类：

```typescript
// src/render/myeditor.ts
export class MyEditorRenderer implements Renderer {
  renderAgent(src: AgentSource, _platform: Platform): string { /* ... */ }
  renderCommand(src: CommandSource, _platform: Platform): string { /* ... */ }
}
```

3. 在 `src/generate.ts` 的 `RENDERERS` 对象中注册。

### 添加新领域

在项目根目录下创建 `.opencode/domains/<id>.json` 文件，格式参考 `src/domains/writing.json`。

## 支持的平台

| 平台 | CLI 标志 | 输出目录 | 渲染族 |
|------|---------|---------|--------|
| Claude Code | `--claude` | `.claude/` | named |
| Oh My Pi | `--omp` | `.omp/` | named |
| Qoder | `--qoder` | `.qoder/` | named |
| OpenCode | `--opencode` | `.opencode/` | mode |
| Kilo Code | `--kilo` | `.kilo/` | mode |
| CodeBuddy | `--codebuddy` | `.codebuddy/` | codebuddy |
| Trae IDE | `--trae` | `.trae/` | trae |

## 完整 CLI 参考

| 选项 | 简写 | 说明 |
|------|------|------|
| `--help` | `-h` | 显示帮助信息 |
| `--version` | `-v` | 显示版本号 |
| `--validate` | `-V` | 验证平台配置与模板一致性 |
| `--watch` | `-w` | 监听文件变化，自动重新生成 |
| `--incremental` | `-i` | 增量生成（仅更新变化文件） |
| `--archive` | `-o` | 导出为 ZIP 压缩包 |
| `--all` | `-a` | 生成/验证/导出所有平台 |
| `--list` | `-l` | 列出支持的平台 |
| `--dry-run` | `-n` | 演练模式，不实际写入 |
| `--domain` | `-d` | 使用指定领域 |
| `--domain-file` | `-D` | 自定义领域文件路径 |

## License

MIT
