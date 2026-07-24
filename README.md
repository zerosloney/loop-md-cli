# loop-md-cli

> Scaffold multi-platform AI coding agent/command configs from a single source. Write templates once, deploy everywhere.

> [中文](./README.zh-CN.md) | English

## Quick Start

```bash
npx @master0071/loop-md-cli --list           # sanity check — you should see 7 platforms
npx @master0071/loop-md-cli --all            # default ralph paradigm, emits .claude/ .opencode/ etc.
npx @master0071/loop-md-cli --validate --all # exit code 0 means every platform matches its templates
```

Requires Node.js >= 18, zero runtime dependencies.

## Basic Usage

```bash
loop-md-cli --all                          # all platforms
loop-md-cli --claude --opencode            # specific platforms
loop-md-cli --claude --domain coding       # specific domain
loop-md-cli --kilo --domain ralph --domain graph  # multi-domain coexistence
loop-md-cli --all --dry-run                # dry run, writes nothing
loop-md-cli --validate --all               # validate consistency
loop-md-cli --watch --claude               # watch for file changes
loop-md-cli --incremental --all            # only rewrite changed files
loop-md-cli --archive configs.zip --all    # export as ZIP
loop-md-cli --trae --domain coding \       # per-role sub-agent models
  --model-orchestrator "DeepSeek-V4-Pro" \
  --model-executor "DeepSeek-V4-Flash" \
  --model-reviewer "Doubao_1_6"
```

## Why?

The 7 AI coding platforms each use a different agent config format; maintaining them by hand is repetitive and error-prone:

| Platform    | Output dir    | frontmatter signature                                                           | tool name format  |
| ----------- | ------------- | ------------------------------------------------------------------------------- | ----------------- |
| Claude Code | `.claude/`    | `name` + `description` + `tools`                                                | PascalCase        |
| OpenCode    | `.opencode/`  | `description` + `mode` + `steps` + `permission`                                 | snake_case        |
| Kilo Code   | `.kilo/`      | same as OpenCode                                                                | snake_case        |
| Trae IDE    | `.trae/`      | `name` + `description` + `tools`                                                | lower + camelCase |
| CodeBuddy   | `.codebuddy/` | `name` + `description` + `model:inherit` + `tools` + `permissionMode`           | PascalCase        |
| Qwen Code   | `.qwen/`      | `name` + `description` + `model` + `tools` + `disallowedTools` + `approvalMode` | PascalCase        |
| Qoder       | `.qoder/`     | same as Claude                                                                  | PascalCase        |

> Every platform supports per-role sub-agent models via `--model-orchestrator/executor/reviewer`. When omitted, sub-agents inherit the main session model.

loop-md-cli solves this with a three-layer abstraction: **templates + domains + renderers**.

## Domain-based Generation

Four built-in domains, each with dedicated templates enforcing its own engineering discipline:

| Domain    | Agent names                                    | Command      | Discipline                                                                                                                          |
| --------- | ---------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `ralph`   | ralph-orchestrator / worker / reviewer         | ralph-loop / ralph-graph | **Kernel paradigm**: TaskList-driven + backpressure breaker (loop); DAG routing + active-set execution (graph). Most general; fallback for custom domains without dedicated templates. |
| `graph`   | graph-orchestrator / graph-worker / graph-reviewer | ralph-graph | **Graph paradigm**: DAG routing with active-set execution. Dynamic mode by default (AI decomposes at runtime); static via `--tasks-file`. |
| `coding`  | coding-orchestrator / builder / reviewer       | coding-loop  | scope discipline + root-cause grouped fixes + zero tolerance for scope drift                                                        |
| `testing` | test-orchestrator / writer / coverage-reviewer | test-loop    | source freeze + three signals (coverage ≥ 80% / mutation ≥ 60% / empty-assertion = 0)                                               |
| `writing` | writing-orchestrator / author / reviewer       | writing-loop | writing boundary + three signals (terminology drift / dead links / code examples)                                                   |

```bash
loop-md-cli --opencode --domain coding
loop-md-cli --opencode --domain testing --dry-run
```

> `ralph` is the kernel paradigm; `coding/testing/writing` are domain specializations built on ralph. Backpressure is a general kernel capability: `coding/testing` use a strong gate (`npm test`), `writing` uses a weak gate (`npm run lint`).

### Custom Domains

Pass custom JSON via `--domain-file`, or drop it in `.opencode/domains/<id>.json` for auto-discovery:

```bash
loop-md-cli --opencode --domain-file ./my-domain.json
loop-md-cli --claude --domain my-domain   # auto-scans .opencode/domains/
```

The JSON requires `engine: { type: "loop" }` or `engine: { type: "graph" }`. The `"graph"` type additionally requires a `tasks` array defining the DAG (see below). Each command must specify `kind: "entry"` and `agent`.

#### Graph Engine

The built-in `graph` domain runs in **dynamic mode** by default — the generated command instructs the orchestrator to decompose `$ARGUMENTS` into a DAG at runtime (zero config). For a **static** routing table, use `--tasks-file`:

```bash
# Dynamic (default): AI decomposes the task at runtime
loop-md-cli --kilo --domain graph

# Static: inject a project-specific DAG from a JSON file
loop-md-cli --kilo --domain graph --tasks-file ./my-tasks.json
```

The tasks file is a JSON array (`[{id, title, depends_on, accept_criteria}]`) or `{tasks: [...]}`. The CLI computes the topological sort and injects a routing table. The example below shows how to define a **custom** graph domain with your own task DAG (team-shared):

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
    { "id": "t1", "title": "Setup",       "depends_on": [] },
    { "id": "t2", "title": "Build",       "depends_on": ["t1"] },
    { "id": "t3", "title": "Test",        "depends_on": ["t2"] },
    { "id": "t4", "title": "Deploy",      "depends_on": ["t2"] }
  ]
}
```

The `tasks` array defines a DAG where each task has `id`, `title`, and optional `depends_on` (array of task IDs). The CLI computes a topological sort and injects a `routing_table` into the generated command template, enabling the orchestrator to execute independent tasks in parallel.

```bash
loop-md-cli --opencode --domain-file ./my-graph-domain.json
```

> `loop` is the kernel paradigm; `coding/testing/writing` are domain specializations built on ralph. Backpressure is a general kernel capability: `coding/testing` use a strong gate (`npm test`), `writing` uses a weak gate (`npm run lint`).

## Custom Templates

### Three-level Fallback

When rendering `<domain>-<role>`, lookup proceeds in order:

1. `<domain>-<role>.md` (e.g. `my-domain-orchestrator.md`) — domain-specific
2. `ralph-<role>.md` — the most general kernel paradigm
3. throw (avoid silently generating 0 files)

A custom domain always runs (falling back to ralph); domain specialization requires dedicated templates.

### Template Format

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

## Role

You are **{{name}}**, the Loop executor agent.
```

### Placeholders

| Placeholder        | Source                                        | Applies to      |
| ------------------ | --------------------------------------------- | --------------- |
| `{{name}}`         | agent/command name from the domain definition | agent           |
| `{{description}}`  | description from the domain definition        | agent + command |
| `{{agent}}`        | orchestrator name the loop binds to           | command         |
| `{{backpressure}}` | the domain's backpressure breaker config      | orchestrator    |
| `{{engine_type}}`  | `engine.type` from the domain definition      | agent           |
| `{{executor_name}}`| executor agent name (from domain, by role)    | command         |
| `{{reviewer_name}}`| reviewer agent name (from domain, by role)    | command         |
| `{{routing_table}}`| DAG topological sort + entry points (graph)   | command (graph)  |

### Built-in Domain Templates

| Domain    | Template files                                                                                | Discipline              |
| --------- | --------------------------------------------------------------------------------------------- | ----------------------- |
| `ralph`   | `ralph-orchestrator.md` / `ralph-worker.md` / `ralph-reviewer.md` / `ralph-loop.md` / `ralph-graph.md` | TaskList + backpressure (loop); DAG routing + active-set (graph) |
| `coding`  | `coding-orchestrator.md` / `coding-executor.md` / `coding-reviewer.md` / `coding-loop.md`     | scope + root-cause      |
| `testing` | `testing-orchestrator.md` / `testing-executor.md` / `testing-reviewer.md` / `testing-loop.md` | source freeze + signals |
| `writing` | `writing-orchestrator.md` / `writing-executor.md` / `writing-reviewer.md` / `writing-loop.md` | writing boundary        |

## Supported Platforms

| Platform    | CLI flag      | Output dir    | Renderer family |
| ----------- | ------------- | ------------- | --------------- |
| Claude Code | `--claude`    | `.claude/`    | named           |
| Qoder       | `--qoder`     | `.qoder/`     | named           |
| Qwen Code   | `--qwen`      | `.qwen/`      | qwen            |
| OpenCode    | `--opencode`  | `.opencode/`  | mode            |
| Kilo Code   | `--kilo`      | `.kilo/`      | mode            |
| CodeBuddy   | `--codebuddy` | `.codebuddy/` | codebuddy       |
| Trae IDE    | `--trae`      | `.trae/`      | trae            |

## Output Examples

The same ralph domain template produces different frontmatter per renderer family. The following are real outputs of `loop-md-cli --all` (lightly trimmed for brevity).

**named family** (Claude Code / Qoder) — `.claude/agents/ralph-reviewer.md`:

```markdown
---
name: ralph-reviewer
description: Ralph Loop reviewer. Read-only quality gate emitting machine-routable verdict/issues.
tools: Read, Grep, Glob, Bash
---
```

**mode family** (OpenCode / Kilo) — `.opencode/agents/ralph-orchestrator.md` (trimmed):

```markdown
---
description: Ralph Loop orchestrator. Maintains the task list, delegates to executor/reviewer, stops on gate decisions.
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

**codebuddy family** — `.codebuddy/agents/ralph-orchestrator.md`:

```markdown
---
name: ralph-orchestrator
description: Ralph Loop orchestrator. Maintains the task list, delegates to executor/reviewer.
model: inherit
permissionMode: default
---
```

**trae family** — `.trae/agents/ralph-reviewer.md`:

```markdown
---
name: ralph-reviewer
description: Ralph Loop reviewer. Read-only quality gate emitting machine-routable verdict/issues.
tools: Read, Grep, Glob
---
```

**qwen family** — `.qwen/agents/ralph-reviewer.md`:

```markdown
---
name: ralph-reviewer
description: Ralph Loop reviewer. Read-only quality gate emitting machine-routable verdict/issues.
tools: Read, Grep, Glob, Bash
disallowedTools: [Write, Edit]
approvalMode: plan
---
```

> Note the qwen family's `disallowedTools: [Write, Edit]` is a YAML flow sequence (array) and must **not** be quoted on render, or it would parse as a string. Only free-text fields (name/description/model) containing dangerous characters like `: ` or ` #` are automatically quoted/escaped.

## Full CLI Reference

| Option                 | Short       | Description                                                                  |
| ---------------------- | ----------- | ---------------------------------------------------------------------------- |
| `--help`               | `-h`        | Show help                                                                    |
| `--version`            | `-V` / `-v` | Show version                                                                 |
| `--validate`           | —           | Validate platform config against templates                                   |
| `--watch`              | `-w`        | Watch for changes, regenerate automatically                                  |
| `--incremental`        | `-i`        | Incremental generation (only rewrite changed files)                          |
| `--archive`            | `-o`        | Export as a ZIP archive                                                      |
| `--all`                | `-a`        | Generate/validate/export all platforms                                       |
| `--list`               | `-l`        | List supported platforms                                                     |
| `--dry-run`            | `-n`        | Dry run, write nothing                                                       |
| `--domain`             | `-d`        | Use the given domain (repeatable: `-d ralph -d graph`)                      |
| `--domain-file`        | `-D`        | Path to a custom domain file                                                 |
| `--tasks-file`         | `-t`        | External tasks DAG file (JSON), injects a static routing table for graph     |
| `--model-orchestrator` | —           | Orchestrator sub-agent model (e.g. `--model-orchestrator "DeepSeek-V4-Pro"`) |
| `--model-executor`     | —           | Executor sub-agent model                                                     |
| `--model-reviewer`     | —           | Reviewer sub-agent model                                                     |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). For change history see [CHANGELOG.md](./CHANGELOG.md); for architecture see [docs/architecture.md](./docs/architecture.md).

## License

MIT
