# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

All notable changes to this project are documented here.

## [Unreleased]

自 v0.4.1 以来的改动（尚未发版）。

### Added

- 增量 manifest 增加 schema 版本字段（`{ version, files }`），加载时校验，不匹配（含旧版扁平格式）自动全量重建。
- 全量模式（默认）也基于 manifest 清理孤儿文件：切换 domain 后删除工具曾生成、本次不再预期的文件；用户手写文件永不触碰。
- 构建时将内置模板复制到 `dist/templates/`，运行时按存在性探测解析模板根（优先 `dist/templates`，回退 `../src/templates`），适配 pnpm / yarn PnP。
- 工程化：引入 ESLint（flat config）+ Prettier、c8 覆盖率（`npm run test:coverage`）、`prepublishOnly` 构建守卫。
- 测试：补充 watch 文件变更触发回归、CLI 进程级集成测试（`--dry-run`/`--validate`/`--domain`/`--archive`）、manifest 版本迁移回归、full-mode 孤儿清理回归。
- 文档：英文 README（`README.md`）+ 中文 README（`README.zh-CN.md`）互链、README 输出示例、`CHANGELOG.md`、`docs/architecture.md`、`docs/README.md` 索引、`CONTRIBUTING.md`。

### Changed

- `generatePlatform` 由 8 个位置参数重构为单一 `GenerateOptions` 对象。
- 重抛错误统一附带 `{ cause }`，保留原始堆栈。
- `FileChange` 携带已计算的 hash，`applyChanges` 复用，避免重复 SHA-256 计算。

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

[Unreleased]: https://github.com/master0071/loop-md-cli/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/master0071/loop-md-cli/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/master0071/loop-md-cli/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/master0071/loop-md-cli/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/master0071/loop-md-cli/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/master0071/loop-md-cli/releases/tag/v0.1.0
