#!/usr/bin/env node
/**
 * loop-forge CLI
 *
 * 用法:
 *   loop-forge --help                    # 显示帮助信息
 *   loop-forge --version                 # 显示版本号
 *   loop-forge --all                     # 生成所有平台
 *   loop-forge --list                    # 列出支持的平台
 *   loop-forge                           # 交互选择平台（非 TTY 报错）
 *   loop-forge --validate --claude       # 验证 claude 配置
 *   loop-forge --watch --claude          # 监听模式，自动重新生成
 *   loop-forge --incremental --claude    # 增量生成（仅更新变化文件）
 *   loop-forge --archive configs.zip     # 导出为 ZIP 压缩包
 *   loop-forge --opencode --domain programming           # 领域化生成
 *   loop-forge --opencode --domain-file ./my.json       # 自定义领域文件
 *   loop-forge --opencode --dry-run                     # 演练，不写盘
 *
 * 模板系统（template.ts）+ 领域注册表（domains.ts）是默认源；
 * 无 domain 时回退到角色名直出。零运行时依赖。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PLATFORMS, PLATFORM_KEYS } from "./platforms.js";
import { generatePlatform } from "./generate.js";
import { validatePlatform, formatValidateResult } from "./validate.js";
import { startWatch } from "./watch.js";
import { exportArchive } from "./export.js";

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
    "loop-forge — 从单一源生成多平台 AI 编码 agent/command 配置",
    "",
    "用法:",
    "  loop-forge [选项]",
    "",
    "选项:",
    "  --help, -h              显示此帮助信息",
    "  --version, -v           显示版本号",
    "  --validate, -V          验证平台配置与模板的一致性",
    "  --watch, -w             监听模板/领域文件变化，自动重新生成",
    "  --incremental, -i       增量生成（仅更新变化文件）",
    "  --archive, -o <path>    导出为 ZIP 压缩包",
    "  --all, -a               生成所有支持的平台",
    "  --list, -l              列出支持的平台",
    "  --dry-run, -n           演练模式，不实际写入文件",
    "  --domain, -d <id>       使用指定领域（builtin: programming, testing, writing）",
    "  --domain-file, -D <path> 自定义领域文件路径（JSON）",
    "",
    "平台选项（可与 --all 互斥，也可单独指定）:",
    "  --claude                Claude Code (.claude/)",
    "  --omp                   Oh My Pi (.omp/)",
    "  --qoder                 Qoder (.qoder/)",
    "  --opencode              OpenCode (.opencode/)",
    "  --kilo                  Kilo Code (.kilo/)",
    "  --codebuddy             CodeBuddy (.codebuddy/)",
    "  --trae                  Trae IDE (.trae/)",
    "",
    "示例:",
    "  loop-forge --all                        # 生成所有平台",
    "  loop-forge --claude --opencode          # 生成指定平台",
    "  loop-forge --opencode --domain testing  # 使用测试领域生成",
    "  loop-forge --opencode --dry-run         # 演练模式预览输出",
    "  loop-forge --validate --all             # 验证所有平台配置",
    "  loop-forge --validate --claude -d programming  # 验证编程领域 claude 配置",
    "  loop-forge --watch --all                # 监听所有平台变化",
    "  loop-forge --watch --claude -d writing  # 监听 claude + writing 领域",
    "  loop-forge --incremental --all          # 增量生成所有平台",
    "  loop-forge --archive configs.zip        # 导出所有平台为 ZIP",
    "  loop-forge --archive configs.zip -d programming  # 导出编程领域",
    "  loop-forge --help                       # 显示帮助",
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
  };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === "--help" || tok === "-h") {
      args.help = true;
    } else if (tok === "--version" || tok === "-v") {
      args.version = true;
    } else if (tok === "--validate" || tok === "-V") {
      args.validate = true;
    } else if (tok === "--watch" || tok === "-w") {
      args.watch = true;
    } else if (tok === "--incremental" || tok === "-i") {
      args.incremental = true;
    } else if (tok === "--archive" || tok === "-o") {
      if (i + 1 < argv.length) {
        args.archive = argv[i + 1];
        i++;
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
    for (const tok of choice.split(/[,\s]+/).filter(Boolean)) {
      if (/^\d+$/.test(tok)) {
        const idx = parseInt(tok, 10);
        if (idx >= 1 && idx <= PLATFORM_KEYS.length) picked.push(PLATFORM_KEYS[idx - 1]);
      }
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
): void {
  const mode = incremental ? "增量" : "全量";
  console.log(`生成 ${selected.length} 个平台 (${mode}): ${selected.join(", ")}${domain ? ` (领域: ${domain})` : ""}`);
  for (const key of selected) {
    const result = generatePlatform(key, dryRun, ".opencode/templates", domain, domainFiles, incremental);
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
    const totalIssues = runValidate(selected, args.domain || undefined, args.domainFiles);
    if (totalIssues > 0) {
      console.error(`\n验证失败: 发现 ${totalIssues} 个问题。请运行 loop-forge --all 重新生成。`);
      process.exit(1);
    }
    console.log("所有平台配置与模板一致。");
    process.exit(0);
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
    const cleanup = startWatch(selected, args.domain || undefined, args.domainFiles);
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
    const result = exportArchive(selected, args.archive, args.domain || undefined, args.domainFiles);
    console.log(`📦 已导出 ${result.fileCount} 个文件 (${result.platformCount} 个平台) → ${result.filePath}`);
    process.exit(0);
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
  runGenerate(selected, args.dryRun, args.domain || undefined, args.domainFiles, args.incremental);
}

main();
