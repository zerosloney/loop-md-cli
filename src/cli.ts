#!/usr/bin/env node
/**
 * loop-md-cli CLI
 *
 * 用法:
 *   loop-md-cli --help                    # 显示帮助信息
 *   loop-md-cli --version                 # 显示版本号
 *   loop-md-cli --all                     # 生成所有平台
 *   loop-md-cli --list                    # 列出支持的平台
 *   loop-md-cli                           # 交互选择平台（非 TTY 报错）
 *   loop-md-cli --validate --claude       # 验证 claude 配置
 *   loop-md-cli --watch --claude          # 监听模式，自动重新生成
 *   loop-md-cli --incremental --claude    # 增量生成（仅更新变化文件）
 *   loop-md-cli --archive configs.zip     # 导出为 ZIP 压缩包
 *   loop-md-cli --opencode --domain coding                # 领域化生成
 *   loop-md-cli --opencode --domain-file ./my.json       # 自定义领域文件
 *   loop-md-cli --opencode --dry-run                     # 演练，不写盘
 *
 * 模板系统（template.ts）+ 领域注册表（domains.ts）是默认源；
 * 无 --domain 时回退到 ralph 内核范式（最通用的 loop 形态）。零运行时依赖。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PLATFORMS, PLATFORM_KEYS } from "./platforms.js";
import { generatePlatform } from "./generate.js";
import { validatePlatform, formatValidateResult } from "./validate.js";
import { startWatch } from "./watch.js";
import { exportArchive } from "./export.js";
import { readDomainFile } from "./domain-schema.js";

// ── Package version ──

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PKG_PATH = join(HERE, "..", "..", "package.json");
let VERSION = "0.1.0";
try {
  const pkg = JSON.parse(readFileSync(PKG_PATH, "utf-8"));
  VERSION = pkg.version || VERSION;
} catch {
  // fallback
}

// ── Help text ──

function printHelp(): void {
  const help = [
    "@master0071/loop-md-cli — 从单一源生成多平台 AI 编码 agent/command 配置",
    "",
    "用法:",
    "  loop-md-cli [选项]",
    "",
    "选项:",
    "  --help, -h              显示此帮助信息",
    "  --version, -V, -v       显示版本号",
    "  --validate              验证平台配置与模板的一致性",
    "  --watch, -w             监听模板/领域文件变化，自动重新生成",
    "  --incremental, -i       增量生成（仅更新变化文件）",
    "  --archive, -o <path>    导出为 ZIP 压缩包",
    "  --all, -a               生成所有支持的平台",
    "  --list, -l              列出支持的平台",
    "  --dry-run, -n           演练模式，不实际写入文件",
    "  --domain, -d <id>       使用指定领域（builtin: ralph, coding, testing, writing；默认 ralph）",
    "  --domain-file, -D <path> 自定义领域文件路径（JSON）",
    "",
    "模型选项（通用，可选，不填则子 agent 继承主会话模型）:",
    "  --model-orchestrator <name>  编排者模型，如 \"DeepSeek-V4-Pro\"",
    "  --model-executor <name>      执行者模型，如 \"DeepSeek-V4-Flash\"",
    "  --model-reviewer <name>      审查者模型，如 \"Doubao_1_6\"",
    "",
    "平台选项（可与 --all 互斥，也可单独指定）:",
    "  --claude                Claude Code (.claude/)",
    "  --qoder                 Qoder (.qoder/)",
    "  --qwen                  Qwen Code (.qwen/)",
    "  --opencode              OpenCode (.opencode/)",
    "  --kilo                  Kilo Code (.kilo/)",
    "  --codebuddy             CodeBuddy (.codebuddy/)",
    "  --trae                  Trae IDE (.trae/)",
    "",
    "示例:",
    "  loop-md-cli --all                        # 生成所有平台",
    "  loop-md-cli --claude --opencode          # 生成指定平台",
    "  loop-md-cli --opencode --domain testing  # 使用测试领域生成",
    "  loop-md-cli --opencode --dry-run         # 演练模式预览输出",
    "  loop-md-cli --validate --all             # 验证所有平台配置",
    "  loop-md-cli --validate --claude -d coding  # 验证编程领域 claude 配置",
    "  loop-md-cli --watch --all                # 监听所有平台变化",
    "  loop-md-cli --watch --claude -d writing  # 监听 claude + writing 领域",
    "  loop-md-cli --incremental --all          # 增量生成所有平台",
    "  loop-md-cli --archive configs.zip        # 导出所有平台为 ZIP",
    "  loop-md-cli --archive configs.zip -d coding  # 导出编程领域",
    "  loop-md-cli --trae --domain coding \\",
    "    --model-orchestrator \"DeepSeek-V4-Pro\" \\",
    "    --model-executor \"DeepSeek-V4-Flash\" \\",
    "    --model-reviewer \"Doubao_1_6\"   # Trae 平台各角色指定不同模型",
    "  loop-md-cli --help                       # 显示帮助",
    "",
  ];
  console.log(help.join("\n"));
}

// ── Argument parsing ──

interface Args {
  help: boolean;
  version: boolean;
  validate: boolean;
  watch: boolean;
  incremental: boolean;
  archive: string;
  all: boolean;
  list: boolean;
  dryRun: boolean;
  domain: string;
  domainFiles: string[];
  picked: string[];
  modelOverrides: Record<string, string>;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    help: false,
    version: false,
    validate: false,
    watch: false,
    incremental: false,
    archive: "",
    all: false,
    list: false,
    dryRun: false,
    domain: "",
    domainFiles: [],
    picked: [],
    modelOverrides: {},
  };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === "--help" || tok === "-h") {
      args.help = true;
    } else if (tok === "--version" || tok === "-V" || tok === "-v") {
      args.version = true;
    } else if (tok === "--validate") {
      args.validate = true;
    } else if (tok === "--watch" || tok === "-w") {
      args.watch = true;
    } else if (tok === "--incremental" || tok === "-i") {
      args.incremental = true;
    } else if (tok === "--archive" || tok === "-o") {
      if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
        args.archive = argv[i + 1];
        i++;
      } else {
        console.error("错误: --archive (-o) 需要指定输出路径。");
        process.exit(1);
      }
    } else if (tok === "--all" || tok === "-a") {
      args.all = true;
    } else if (tok === "--list" || tok === "-l") {
      args.list = true;
    } else if (tok === "--dry-run" || tok === "-n") {
      args.dryRun = true;
    } else if ((tok === "--domain" || tok === "-d") && i + 1 < argv.length) {
      args.domain = argv[i + 1];
      i++;
    } else if ((tok === "--domain-file" || tok === "-D") && i + 1 < argv.length) {
      args.domainFiles.push(argv[i + 1]);
      i++;
    } else if (tok === "--model-orchestrator" && i + 1 < argv.length) {
      args.modelOverrides["orchestrator"] = argv[i + 1];
      i++;
    } else if (tok === "--model-executor" && i + 1 < argv.length) {
      args.modelOverrides["executor"] = argv[i + 1];
      i++;
    } else if (tok === "--model-reviewer" && i + 1 < argv.length) {
      args.modelOverrides["reviewer"] = argv[i + 1];
      i++;
    } else if (tok.startsWith("--") && tok.length > 2) {
      const key = tok.slice(2);
      if (PLATFORMS[key]) {
        args.picked.push(key);
      } else {
        console.error(`错误: 未知选项 ${tok}。用 --help 查看用法。`);
        process.exit(1);
      }
    } else {
      console.error(`错误: 未知参数 ${tok}。用 --help 查看用法。`);
      process.exit(1);
    }
  }
  return args;
}

// ── Domain 解析 ──

/**
 * 解析最终生效的 domain id。规则：
 *   1. 显式 --domain 优先
 *   2. 否则若传了单个 --domain-file，从文件读 id 自动推导（README 宣传的用法）
 *   3. 多个 --domain-file 且无 --domain：报错（多个文件无法确定单一 id）
 *   4. 都没有：undefined（由 generate.ts 回退到 ralph）
 *
 * 读文件失败时抛错——和后续 generate 阶段一致，不静默吞。
 */
function resolveDomainId(explicit?: string, domainFiles: string[] = []): string | undefined {
  if (explicit) return explicit;
  if (domainFiles.length === 0) return undefined;
  if (domainFiles.length > 1) {
    throw new Error("传了多个 --domain-file 但未指定 --domain。请用 --domain <id> 明确选择。");
  }
  const d = readDomainFile(domainFiles[0]);
  return d.id;
}

// ── Interactive selection ──

function interactiveSelect(dryRun: boolean): void {
  if (!process.stdin.isTTY) {
    console.error("错误: 未指定平台且非交互环境。用 --all 或 --<platform>。");
    process.exit(1);
  }
  console.log("可用平台:");
  for (let i = 0; i < PLATFORM_KEYS.length; i++) {
    const k = PLATFORM_KEYS[i];
    console.log(`  ${i + 1}. ${k.padEnd(11)} ${PLATFORMS[k].note}`);
  }
  console.log("  0. 全部");
  process.stdout.write("选择(数字/逗号分隔,a=全部): ");
  const chunks: Buffer[] = [];
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("end", () => {
    const choice = Buffer.concat(chunks).toString("utf-8").trim();
    if (["0", "a", "all", "*"].includes(choice)) return finish(PLATFORM_KEYS);
    const picked: string[] = [];
    const invalid: string[] = [];
    for (const tok of choice.split(/[,\s]+/).filter(Boolean)) {
      if (/^\d+$/.test(tok)) {
        const idx = parseInt(tok, 10);
        if (idx >= 1 && idx <= PLATFORM_KEYS.length) {
          picked.push(PLATFORM_KEYS[idx - 1]);
        } else {
          invalid.push(tok);
        }
      } else {
        invalid.push(tok);
      }
    }
    if (invalid.length > 0) {
      console.error(`无效选择: ${invalid.join(", ")}（请输入 1-${PLATFORM_KEYS.length} 的数字，或 0/a 选全部）。`);
      process.exit(1);
    }
    if (picked.length === 0) {
      console.error("未选择任何平台,退出。");
      process.exit(1);
    }
    finish(picked);
  });
  function finish(selected: string[]): never {
    runGenerate(selected, dryRun);
    process.exit(0);
  }
}

// ── Output helpers ──

function listPlatforms(): void {
  console.log("支持的平台:");
  for (const k of PLATFORM_KEYS) {
    const p = PLATFORMS[k];
    console.log(`  --${k.padEnd(11)} → ${p.dir.padEnd(12)} [${p.family}] ${p.note}`);
  }
}

function runGenerate(
  selected: string[],
  dryRun: boolean,
  domain?: string,
  domainFiles: string[] = [],
  incremental = false,
  modelOverrides: Record<string, string> = {},
): void {
  const mode = incremental ? "增量" : "全量";
  const modelInfo = Object.keys(modelOverrides).length > 0 ? ` (模型: ${Object.entries(modelOverrides).map(([r, m]) => `${r}=${m}`).join(", ")})` : "";
  console.log(`生成 ${selected.length} 个平台 (${mode}): ${selected.join(", ")}${domain ? ` (领域: ${domain})` : ""}${modelInfo}`);
  for (const key of selected) {
    const result = generatePlatform(key, dryRun, ".opencode/templates", domain, domainFiles, incremental, undefined, modelOverrides);
    if (incremental && typeof result.written === "number") {
      console.log(`[${key}] ${PLATFORMS[key].dir}/ → agents/${result.agents} commands/${result.commands} (+${result.written} 更新)`);
    } else {
      console.log(`[${key}] ${PLATFORMS[key].dir}/ → agents/${result.agents} commands/${result.commands}`);
    }
  }
  console.log("\n完成。修改 agents/ 或 commands/ 后重跑同步。");
}

function runValidate(selected: string[], domain?: string, domainFiles: string[] = []): number {
  let totalIssues = 0;
  for (const key of selected) {
    const result = validatePlatform(key, ".opencode/templates", domain, domainFiles);
    console.log(formatValidateResult(result));
    totalIssues += result.issueCount;
    console.log("");
  }
  return totalIssues;
}

// ── Entry point ──

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  // --domain 未指定时从 --domain-file 自动推导（单文件场景）。
  // 多文件且无 --domain 时这里抛错，避免后续静默用错领域。
  let domainId: string | undefined;
  try {
    domainId = resolveDomainId(args.domain, args.domainFiles);
  } catch (err) {
    console.error(`错误: ${(err as Error).message}`);
    process.exit(1);
  }
  runCommand(args, domainId);
}

function runCommand(args: Args, domainId: string | undefined): void {
  if (args.help) {
    printHelp();
    return;
  }

  if (args.version) {
    console.log(VERSION);
    return;
  }

  if (args.list) {
    listPlatforms();
    return;
  }

  if (args.validate) {
    let selected: string[];
    if (args.all) {
      selected = [...PLATFORM_KEYS];
    } else if (args.picked.length > 0) {
      selected = args.picked;
    } else {
      console.error("错误: --validate 需要指定平台（--all 或 --<platform>）。");
      process.exit(1);
    }
    const totalIssues = runValidate(selected, domainId, args.domainFiles);
    if (totalIssues > 0) {
      console.error(`\n验证失败: 发现 ${totalIssues} 个问题。请运行 loop-md-cli --all 重新生成。`);
      process.exit(1);
    }
    console.log("所有平台配置与模板一致。");
    return;
  }

  if (args.watch) {
    let selected: string[];
    if (args.all) {
      selected = [...PLATFORM_KEYS];
    } else if (args.picked.length > 0) {
      selected = args.picked;
    } else {
      console.error("错误: --watch 需要指定平台（--all 或 --<platform>）。");
      process.exit(1);
    }
    const cleanup = startWatch(selected, domainId, args.domainFiles, undefined, args.incremental);
    process.on("SIGINT", () => {
      console.log("\n👋 监听已停止。");
      cleanup();
      process.exit(0);
    });
    return;
  }

  if (args.archive) {
    let selected: string[];
    if (args.all) {
      selected = [...PLATFORM_KEYS];
    } else if (args.picked.length > 0) {
      selected = args.picked;
    } else {
      console.error("错误: --archive 需要指定平台（--all 或 --<platform>）。");
      process.exit(1);
    }
    const result = exportArchive(selected, args.archive, domainId, args.domainFiles);
    console.log(`📦 已导出 ${result.fileCount} 个文件 (${result.platformCount} 个平台) → ${result.filePath}`);
    return;
  }

  let selected: string[];
  if (args.all) {
    selected = [...PLATFORM_KEYS];
  } else if (args.picked.length > 0) {
    selected = args.picked;
  } else {
    interactiveSelect(args.dryRun);
    return;
  }
  runGenerate(selected, args.dryRun, domainId, args.domainFiles, args.incremental, args.modelOverrides);
}

main();
