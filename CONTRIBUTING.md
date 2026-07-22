# 贡献指南

感谢考虑为 loop-md-cli 做贡献。本文档说明开发环境搭建、测试命令、代码规范，以及新增平台 / 领域的步骤。

## 开发环境

- Node.js >= 18（零运行时依赖，所有功能用标准库实现）
- 包管理：npm（仓库含 `package-lock.json`）

```bash
git clone https://github.com/master0071/loop-md-cli.git
cd loop-md-cli
npm install
```

常用命令：

```bash
npm run dev -- --list      # tsx 直接跑 src/cli.ts（开发调试，-- 后是 CLI 参数）
npm run build              # 清空 dist → tsc 编译 → 复制 src/templates 到 dist/templates
npm start -- --all         # 跑构建产物 dist/cli.js
```

## 测试

测试用 Node 内置 `node:test` runner，**必须先编译再跑**（源码用 `.js` 扩展名导入 TS 模块，直接对 `src/` 跑 `node --test` 会 `ERR_MODULE_NOT_FOUND`）：

```bash
npm test               # tsc 编译 → node --test "dist/__tests__/*.test.js"
npm run test:coverage  # 同上，外加 c8 覆盖率（text + lcov）
```

提交前请保证 `npm test` 全绿。非平凡逻辑应补对应测试；bug 修复优先补一个能复现的测试再修。

## 代码规范

ESLint（flat config + typescript-eslint）与 Prettier 已配置好：

```bash
npm run lint          # 检查
npm run lint:fix      # 自动修复
npm run format        # prettier 写入
npm run format:check  # prettier 检查（CI 用）
```

约定要点：

- TypeScript strict，ESM，`printWidth: 100`、双引号、分号、`trailingComma: all`。
- 未用变量以 `^_` 前缀豁免（`@typescript-eslint/no-unused-vars`）。
- 手术式变更：只动必须动的，匹配现有风格，不顺手重构无关代码。
- 错误处理附 `{ cause: err }` 保留根因；不吞异常，降级要保留原因。
- `src/templates/` 与 `package-lock.json` 在 `.prettierignore` 中，不被格式化。

## 提交约定

- 提交信息聚焦"为什么"，简洁一两行；遵循仓库既有风格（查看 `git log`）。
- 一个提交做一件事；避免混入无关格式化改动。
- 涉及用户可见行为变化时，更新 [CHANGELOG.md](./CHANGELOG.md) 的 `[Unreleased]` 段。
- 版本号遵循 semver；发布由维护者通过 `npm publish` 触发（`prepublishOnly` 会自动 build + test）。

## 新增平台（renderer 家族复用）

平台是数据驱动的，复用已有 family 时只需在 `src/platforms.ts` 加一行：

```typescript
myplatform: { id: "myplatform", dir: ".myplatform", family: "named", note: "My Platform" },
```

`family` 取值：`named` / `mode` / `codebuddy` / `trae` / `qwen`（见 [docs/architecture.md](./docs/architecture.md)）。CLI flag `--myplatform` 会自动可用。补一条 `src/__tests__/` 里的渲染断言，并更新 README 的平台表与 `docs/README.md` 索引。

若目标平台的 frontmatter 格式不属于任何已有 family，则在 `src/render/` 新建一个实现 `Renderer` 接口的家族，注册进 `generate.ts` 的 `RENDERERS` 与 `platforms.ts` 的 `Family` 联合类型，并补 `renderers.test.ts`。

## 新增领域

1. 在 `src/domains.ts` 的 `DOMAINS` 加一条（`engine.type` 必须为 `loop`，每个 command 显式声明 `agent`），或通过 `.opencode/domains/<id>.json` / `--domain-file` 提供自定义领域。
2. 如需领域专属纪律，在 `src/templates/agents/` 与 `src/templates/commands/` 加 `<id>-<role>.md` / `<id>-loop.md`；不加则自动回退 `ralph-*` 内核范式。
3. 补 `domain-schema.test.ts` / `generate.test.ts` 相应断言。

## 发布前检查

```bash
npm run lint && npm run format:check && npm test && npm run build
```

## 行为准则

保持友善、就事论事。有问题先开 issue 讨论，欢迎小而聚焦的 PR。
