#!/usr/bin/env node
/**
 * loop-forge CLI
 *
 * 用法:
 *   loop-forge --claude --opencode        # 选指定平台
 *   loop-forge --all                      # 全部平台
 *   loop-forge --list                     # 列出支持的平台
 *   loop-forge                            # 无参 → 交互选择（非 TTY 报错）
 *
 * 从 agents/*.md + commands/*.md（单一真相源）渲染到各平台目录。
 * 零运行时依赖（参数手写解析，对齐原 argparse 行为）。
 */
import { PLATFORMS, PLATFORM_KEYS } from "./platforms.js";
import { generatePlatform } from "./generate.js";

interface Args {
  all: boolean;
  list: boolean;
  picked: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = { all: false, list: false, picked: [] };
  for (const tok of argv) {
    if (tok === "--all" || tok === "-a") args.all = true;
    else if (tok === "--list" || tok === "-l") args.list = true;
    else if (tok.startsWith("--") && tok.length > 2) {
      const key = tok.slice(2);
      if (PLATFORMS[key]) args.picked.push(key);
      else {
        console.error(`错误:未知选项 ${tok}。用 --list 查看支持的平台。`);
        process.exit(1);
      }
    }
  }
  return args;
}

function interactiveSelect(): string[] {
  if (!process.stdin.isTTY) {
    console.error("错误:未指定平台且非交互环境。用 --all 或 --<platform>。");
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
  return []; // 实际通过回调执行
  function finish(selected: string[]): never {
    runGenerate(selected);
    process.exit(0);
  }
}

function listPlatforms(): void {
  console.log("支持的平台:");
  for (const k of PLATFORM_KEYS) {
    const p = PLATFORMS[k];
    console.log(`  --${k.padEnd(11)} → ${p.dir.padEnd(12)} [${p.family}] ${p.note}`);
  }
}

function runGenerate(selected: string[]): void {
  console.log(`生成 ${selected.length} 个平台: ${selected.join(", ")}`);
  for (const key of selected) {
    const { agents, commands } = generatePlatform(key);
    console.log(`[${key}] ${PLATFORMS[key].dir}/ → agents/${agents} commands/${commands}`);
  }
  console.log("\n完成。修改 agents/ 或 commands/ 后重跑同步。");
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    listPlatforms();
    return;
  }

  let selected: string[];
  if (args.all) {
    selected = [...PLATFORM_KEYS];
  } else if (args.picked.length > 0) {
    selected = args.picked;
  } else {
    interactiveSelect();
    return; // interactiveSelect 异步执行
  }
  runGenerate(selected);
}

main();
