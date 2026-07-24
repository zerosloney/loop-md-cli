# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

All notable changes to this project are documented here.

## [Unreleased]

## [0.9.1] - 2026-07-24

自 v0.9.0 以来的改动：CI 发布流水线修复。

### Fixed

- **CI Node 版本升级**：`ci.yml` 和 `publish.yml` 的 `node-version` 从 18 升到 22。Node 18 不展开 `node --test "dist/__tests__/*.test.js"` 的 glob 模式，导致 CI 报 "Could not find .../*.test.js"。该问题在 v0.9.0 之前就存在（旧 ci.yml 仅在 PR 触发，直接 push master 从未在 Linux 跑过测试），v0.9.0 引入 publish workflow 时暴露。

### Added

- **tag 触发的 npm publish workflow**（`.github/workflows/publish.yml`）：推送 `v*` 格式 tag 时自动跑 `npm ci` → `lint` → `test` → `npm publish --access public`，用 GitHub Secret `NPM_TOKEN` 鉴权。

## [0.9.0] - 2026-07-24

自 v0.8.0 以来的改动：路由表外置化 + 死代码清理。

### Changed

- **路由表外置**：graph 领域的静态路由表不再注入命令 markdown，改为在生成时落盘到 `.loop-cli/routing-tables/default.json`（与 state/cache 同属项目级 `.loop-cli/` 配置区）。运行时按模板"路由表加载协议"的第二优先级（SOP 文件）读取。`--tasks-file` 导入的外部 DAG 经 `buildRoutingTable` 计算后写入此文件。
- **删除死代码**：移除从未被调用的 `fillGraphDagSections` helper（v0.8.0 重构遗留）。连带清理 `renderCommandWithTemplates` 的 `tasks?` 参数和 `renderDomainFiles` 的 `tasksOverride?` 参数（孤儿参数）。
- `validate.ts` 不再解析 `tasksFile`（路由表已外置，validate 只逐字节比对 `.md` 文件，parity 自动保持）。`validatePlatform` 的 `tasksFile` 参数保留为 `_tasksFile` 以维持公共签名兼容。

### Added

- **schema 形状文档化**：模板"路由表加载协议"新增 `intentional-simple` 说明，明确区分两种 `nodes` 形状——路由表（tier-2/3）为纯拓扑定义（title/depends_on/accept_criteria），状态文件（tier-1）为运行时进度（status/failures/result）。加载纯拓扑路由表后 orchestrator 需自行补运行时字段。

### Fixed

- 修复 v0.8.0 的 `--tasks-file` 实际无效问题（`fillGraphDagSections` 从未被调用，导致注入的 tasks 被静默丢弃）。

## [0.8.0] - 2026-07-24

自 v0.7.0 以来的改动：graph 引擎动态 DAG —— 单模板自动切换静态/动态双模式。

### Added

- **动态 DAG 模式**：内置 `graph` 领域去掉静态 tasks，默认走动态模式。生成的 `ralph-graph.md` 命令文件含动态分解指令——AI 运行时从 `$ARGUMENTS` 自行拆解任务为 DAG 节点（id/title/depends_on/accept_criteria），计算 entry_points 和 topological_order。零配置即可用，适配任意运行时任务。
- **`--tasks-file` 参数**（`-t`）：传入外部 tasks JSON（裸数组或 `{tasks: [...]}`），注入 graph 领域生成精确静态路由表。复用 `domain-schema` 的环路检测和字段校验。适用于项目专属 DAG 场景。
- 双模式自动切换：同一个 `ralph-graph.md` 模板，有 tasks（领域声明或 `--tasks-file`）→ 静态路由表分支；无 tasks → 动态分解分支。由 `fillGraphDagSections` 共享 helper 填充 `routing_table_section` / `dynamic_dag_section` 占位符。

### Changed

- 内置 `graph` 领域不再内置示例 tasks（t1→t2/t3→t4）。改为纯动态模式——开箱即用时 AI 运行时分解；想要静态拓扑用 `--tasks-file` 或自定义 domain JSON。
- `generatePlatform` / `validatePlatform` / `startWatch` / `exportArchive` 新增 `tasksFile?` 参数透传；`renderCommandWithTemplates` 双分支填充与 `renderDomainFiles` 共用 `fillGraphDagSections`。
- `readTasksFile` 导出，供 validate 复用（保证 generate/validate 一致）。

## [0.7.0] - 2026-07-24

自 v0.6.1 以来的改动：支持多领域共存生成 + 同名预检跳过。

### Added

- **多领域共存**：`--domain` 支持多次传入或逗号分隔，一次生成多个领域，互不清理。例如 `loop-md-cli --kilo --domain ralph --domain graph` 会在同一个 `.kilo/` 里保留两套配置（6 agents + 2 commands）。`generatePlatform` 新增 `domains?: string[]` 选项（与 `domain?` 合并去重）。
- **同名预检跳过**：生成某领域前检查目标文件是否已存在，只要有任一文件已存在则跳过整个领域（不覆盖、不清理），并打印 `[skip]` 提示。被跳过领域的已有文件会被保留（纳入 expectedFiles 防止孤儿清理误删）。新增 `skipIfExists` 选项（默认 true，watch 模式下强制 false 以保证重新生成）。

### Changed

- `cli.ts`：`args.domain`（string）改为 `args.domains`（string[]），`--domain` / `-d` 支持多次传入和逗号分隔；`resolveDomainId` 改为 `resolveDomainIds` 返回数组，去掉多 domain-file 报错。
- `validate.ts`：`validatePlatform` 第三参数支持 `string | string[]`，遍历所有领域合并预期文件。
- `watch.ts` / `export.ts`：透传 `domains` 数组；watch 模式强制 `skipIfExists: false`。

## [0.6.1] - 2026-07-24

自 v0.6.0 以来的改动：graph 领域恢复独立三角色 + 内核模板占位符化 + 回退警告噪音消除。

### Fixed

- **graph 领域三角色混入 ralph**：v0.6.0 中 graph 领域的 executor/reviewer 复用了 `ralph-worker` / `ralph-reviewer`（因 `ralph-graph.md` 模板硬编码），导致生成结果缺少独立 graph 角色。根因修复：`ralph-loop.md` / `ralph-graph.md` 内核模板的委派 agent 名由硬编码改为 `{{executor_name}}` / `{{reviewer_name}}` 占位符，由领域定义按 role 动态注入。graph 领域恢复独立三角色：`graph-orchestrator` / `graph-worker` / `graph-reviewer`。
- 内置 `graph` 领域生成时打印 4 条 `领域模板 ... 未找到，回退到 ralph-*` 警告。graph 领域复用 ralph 内核模板是预期行为。`pickTemplate` / `pickCommandTemplate` 对内置领域（`domainId in DOMAINS`）不再告警，仅自定义领域保留警告以抓文件名拼写错误。

### Changed

- `generatePlatform` / `renderCommandWithTemplates` 注入 `executor_name` / `reviewer_name` 变量（从领域 agents 按 role 查找）；`validate.ts` 同步传参，保持 generate/validate 一致性。

## [0.6.0] - 2026-07-23

自 v0.5.1 以来的改动：新增内置 `graph` 领域，`--domain graph` 开箱即用生成 DAG 路由命令。

### Added

- 新增内置 `graph` 领域（`engine.type=graph`）：内置示例 DAG 任务图（t1→t2/t3→t4），生成 `ralph-graph` 命令 + 路由表。`--domain graph` 即可直接使用，无需自定义 JSON。graph 领域的 executor/reviewer 复用 `ralph-worker` / `ralph-reviewer`（`ralph-graph.md` 模板委派段硬编码），仅 orchestrator 独立为 `graph-orchestrator`。
- `Domain` 接口增加 `tasks?: TaskDefinition[]` 字段；`loadBuiltinDomains` 同步拷贝 tasks，使内置 graph 领域的 DAG 定义进入生成管线。

### Fixed

- `--validate` 误报 graph 命令 stale：`renderCommandWithTemplates`（validate 复用的渲染管线）漏传 `routing_table`，导致 graph 命令模板里的 `{{routing_table}}` 未替换，与磁盘上已渲染的文件不一致。补 `tasks` 参数，validate 传 `resolvedDomain.tasks`，与 `generatePlatform` 注入路径对齐（同 v0.5.1 `engine_type` 漏传同类问题）。

## [0.5.1] - 2026-07-23

自 v0.5.0 以来的改动：graph 引擎鲁棒性修复（拓扑环路检测、生成文件原子写入、模板回退警告、STALL 签名优化）。

### Added

- `buildRoutingTable` 拓扑排序后增加环路检测：若 Kahn 算法未覆盖全部节点则抛错（列出环上节点），避免静默生成不完整的 DAG 路由表。与 `domain-schema.ts` 的 schema 层 DFS 环检测形成纵深防御。
- `incremental.ts` 新增 `writeAtomic` 原子写入 helper（`.tmp` → `rename`），全量生成循环、`applyChanges`、`saveManifest` 三处复用，防止写入中途崩溃导致单文件损坏。

### Changed

- `ralph-graph.md` STALL 签名由 `id:status` 扩展为 `id:status:failures`，纳入节点 `failures` 计数。区分"真停滞"与"Worker 反复失败仍在尝试"——后者 `failures` 递增使签名变化，避免 `stall_counter` 过快增长误判 STALL。

### Fixed

- 模板回退静默覆盖：`pickTemplate` / `pickCommandTemplate` 在领域专属模板缺失、回退到 `ralph-*` 内核范式时打印 `console.warn`（含期望文件名），便于用户定位文件名拼写错误。
- `--validate` 误报 stale：`renderAgentWithTemplates`（validate 复用的渲染管线）构造模板变量时漏传 `engine_type`，导致含 `{{engine_type}}` 的 agent 模板（如 `ralph-orchestrator.md`）在预期产物中未渲染，与磁盘上已渲染的文件不一致。补 `engineType` 参数，validate 传 `resolvedDomain.engine.type`，`renderAgent` 公开 API 默认 `loop`。

## [0.5.0] - 2026-07-22

自 v0.4.1 以来的改动。

### Added

- 增量 manifest 增加 schema 版本字段（`{ version, files }`），加载时校验，不匹配（含旧版扁平格式）自动全量重建。
- 全量模式（默认）也基于 manifest 清理孤儿文件：切换 domain 后删除工具曾生成、本次不再预期的文件；用户手写文件永不触碰。
- 构建时将内置模板复制到 `dist/templates/`，运行时按存在性探测解析模板根（优先 `dist/templates`，回退 `../src/templates`），适配 pnpm / yarn PnP。
- 工程化：引入 ESLint（flat config）+ Prettier、c8 覆盖率（`npm run test:coverage`）、`prepublishOnly` 构建守卫。
- 测试：补充 watch 文件变更触发回归、CLI 进程级集成测试（`--dry-run`/`--validate`/`--domain`/`--archive`）、manifest 版本迁移回归、full-mode 孤儿清理回归。
- 文档：英文 README（`README.md`）+ 中文 README（`README.zh-CN.md`）互链、README 输出示例、`CHANGELOG.md`、`docs/architecture.md`、`docs/README.md` 索引、`CONTRIBUTING.md`。
- Loop 状态 schema 新增 `stall_counter` 字段与 `STALL_MAX` 阈值（ralph=3，coding/testing/writing=2）；STALL 停止条件由”连续多轮无变化”改为可判定的 `stall_counter >= STALL_MAX`（按任务状态签名逐轮比对），覆盖全部四个领域。
- 测试：新增 ralph-loop 命令产物回归断言（禁止混入 coding scope/baseline 模型，且必须含 stall_counter/STALL_MAX）。
- **Graph 引擎**：`ENGINE_TYPES` 新增 `”graph”`，领域定义支持 `engine: { type: “graph” }`；`tasks` 数组定义 DAG 节点（`id` / `title` / `depends_on` / `accept_criteria`），schema 层 DFS 环路检测拦截循环依赖。
- **Graph 模板**：新增 `ralph-graph.md` 命令模板（DAG 路由协议：激活节点集 active_set、状态机 pending→in_progress→done/blocked、version=2 状态文件、STALL/MAX_CYCLES 停止条件、ralph-worker / ralph-reviewer 委派）。
- **拓扑排序**：`buildRoutingTable` 以 Kahn 算法计算 DAG 拓扑序，产出 `entry_points` + `topological_order` + `nodes` 映射，注入为 `routing_table` 模板变量；`pickCommandTemplate` 按 engine type 路由到 `ralph-graph.md` / `ralph-loop.md`。

### Changed

- `generatePlatform` 由 8 个位置参数重构为单一 `GenerateOptions` 对象。
- 重抛错误统一附带 `{ cause }`，保留原始堆栈。
- `FileChange` 携带已计算的 hash，`applyChanges` 复用，避免重复 SHA-256 计算。
- ralph 内核 `ralph-loop` 命令模板的注入上下文下沉对齐到 ralph agent 输入契约（`accept_criteria` / `已知上下文` / `本轮变更`），移除误入的 coding 领域 `hard_scope` / `声明边界` / `Baseline`，消除命令层与 agent 层的契约漂移。
- command 模板 lookup 由 `ralph-<engineType>` 扩展为 `<domainId>-<engineType>` → `ralph-<engineType>` 两级，graph 引擎通过 `engine.type` 自动路由到 `ralph-graph.md`。

### Fixed

- 交互模式丢失 domain/model/incremental 上下文（`-d coding` 进交互后被丢弃）。
- `--dry-run` 仍创建输出目录的副作用。
- 渲染器 frontmatter 缺少 YAML 转义（含 `: `、` #`、以 `[`/`{` 开头的值生成非法 YAML）。
- `--validate` 在 Windows 上的 CRLF 误报（比较前统一 normalize 为 LF）。
- 版本号回退硬编码（非标准安装路径下 `--version` 报 0.1.0）。

## [0.4.1] - 2026-07-22

### Changed

- README 同步按角色指定子 agent 模型的配置说明。

## [0.4.0] - 2026-07-22

### Added

- 新增 Qwen Code 平台支持（`--qwen`，渲染族 qwen）。
- 子 agent 支持按角色独立指定模型（`--model-orchestrator/executor/reviewer`），覆盖 trae / codebuddy / kilo / opencode / qoder。

### Removed

- 移除 Oh My Pi (omp) 平台支持（官方无 subagent 文档）。

## [0.3.0] - 2026-07-21

### Changed

- 所有命令模板改用子代理工具调用，替代 JSON action 抽象委派。
- 包名改为 scoped `@master0071/loop-md-cli`，同步帮助文本与 README。

### Fixed

- `bin` 路径去掉 `./` 前缀。

## [0.2.0] - 2026-07-21

### Added

- validate / incremental / watch / export 管线与模板系统重构。
- 确立 ralph 为内核范式，泛化 backpressure（背压熔断）。
- 引入 engine + `command.kind`/`command.agent`（L1+L2+L3 概念分层）。
- 委派机制 + 版本化状态 schema 范式（覆盖 4 领域模板）。
- 为 coding / testing / writing 补齐专属领域模板。
- 团队导向 README 章节（30s 快速上手、工作流、CI、FAQ）。

### Changed

- `programming` 领域重命名为 `coding`（id + 产出名 + 模板 + 文档全量对齐）。
- watch 改用 `fs.watch` 目录级监听，ralph 增加状态持久化段。
- `renderTemplate` 改用单次正则 replace。
- README 精简（636 → 154 行，-76%）。

### Fixed

- reviewer 权限 / ZIP Unicode / incremental 孤儿三个缺陷。
- archive 不再污染用户工程目录；补齐 LICENSE。
- 收口领域文件路径约定 + 自动扫描 + manifest 隔离。
- 收敛 defaultDomain 双源；watch 支持 incremental；build 清理 dist。
- 移除模板中硬编码 Trae 的路由举例，改用中性描述。

## [0.1.0] - 2026-07-17

### Added

- 初始发布（loop-forge）：多平台 AI agent/command 配置生成器。

[Unreleased]: https://github.com/master0071/loop-md-cli/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/master0071/loop-md-cli/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/master0071/loop-md-cli/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/master0071/loop-md-cli/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/master0071/loop-md-cli/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/master0071/loop-md-cli/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/master0071/loop-md-cli/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/master0071/loop-md-cli/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/master0071/loop-md-cli/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/master0071/loop-md-cli/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/master0071/loop-md-cli/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/master0071/loop-md-cli/releases/tag/v0.1.0
