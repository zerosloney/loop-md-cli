/**
 * watch 模式：监听模板和领域文件变化，自动重新生成。
 *
 * 用 fs.watch 监听模板目录（agents/、commands/），新增 .md 文件也能触发；
 * 自定义领域文件保持 fs.watchFile（用户指定单文件，无需目录级监听）。
 * 防抖策略：同一事件 300ms 内的多次触发只调用一次生成。
 */
import { watch, watchFile, unwatchFile, existsSync, type FSWatcher } from "node:fs";
import { join } from "node:path";

import { generatePlatform } from "./generate.js";

const DEFAULT_TEMPLATES_ROOT = ".opencode/templates";

/** 去抖器：同一文件在短时间内多次变化只触发一次回调 */
class Debouncer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending = false;
  private callback: () => void;
  private delay: number;

  constructor(callback: () => void, delay = 300) {
    this.callback = callback;
    this.delay = delay;
  }

  trigger(): void {
    this.pending = true;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      if (this.pending) {
        this.pending = false;
        this.callback();
      }
    }, this.delay);
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = false;
  }
}
/**
 * 启动 watch 模式，返回清理函数。
 * @param platforms 要监控的平台列表
 * @param domains 领域 ID 列表（支持多领域共存）
 * @param domainFiles 自定义领域文件路径
 * @param cwd 工作目录，默认为 process.cwd()
 * @param incremental 是否走增量生成（仅写变化的文件），默认 false（全量）
 */
export function startWatch(
  platforms: string[],
  domains: string[] = [],
  domainFiles: string[] = [],
  cwd = process.cwd(),
  incremental = false,
  tasksFile?: string,
): () => void {
  const debouncer = new Debouncer(() => {
    runGeneration(platforms, domains, domainFiles, cwd, incremental, tasksFile);
  }, 300);

  const watchers: FSWatcher[] = [];

  // 监听模板目录（fs.watch 目录级，新增 .md 文件也能触发）
  const templatesBase = join(cwd, DEFAULT_TEMPLATES_ROOT);
  const watchTemplateDir = (subdir: string) => {
    const dir = join(templatesBase, subdir);
    if (!existsSync(dir)) return;
    try {
      const w = watch(dir, (eventType, filename) => {
        // filename 可能为 null（某些平台/场景），此时保守触发
        if (!filename || filename.endsWith(".md")) {
          debouncer.trigger();
        }
      });
      watchers.push(w);
    } catch {
      // 目录不可监听时静默降级——不会漏文件，只是不会自动刷新
    }
  };
  watchTemplateDir("agents");
  watchTemplateDir("commands");

  // 监听自定义领域文件（单文件，watchFile 更可靠）
  // interval=1000：默认 5s 对领域文件延迟偏大，1s 足够灵敏且几乎零成本。
  for (const file of domainFiles) {
    watchFile(file, { interval: 1000 }, () => {
      debouncer.trigger();
    });
  }

  // 初始生成
  const modeLabel = incremental ? "增量" : "全量";
  console.log("👀 监听模板和领域文件变化...");
  console.log(`   平台: ${platforms.join(", ")}`);
  console.log(`   模式: ${modeLabel}`);
  if (domains.length > 0) console.log(`   领域: ${domains.join(", ")}`);
  console.log("   按 Ctrl+C 退出\n");
  runGeneration(platforms, domains, domainFiles, cwd, incremental, tasksFile);

  // 返回清理函数
  return () => {
    debouncer.dispose();
    for (const w of watchers) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
    for (const file of domainFiles) {
      try {
        unwatchFile(file);
      } catch {
        /* ignore */
      }
    }
  };
}
function runGeneration(
  platforms: string[],
  domains: string[],
  domainFiles: string[],
  cwd: string,
  incremental: boolean,
  tasksFile?: string,
): void {
  for (const key of platforms) {
    const { agents, commands, written } = generatePlatform(key, {
      domains,
      domainFiles,
      incremental,
      cwd,
      tasksFile,
      // watch 模式下重新生成必须覆盖（模板/领域文件变了就该重写），不能因文件已存在而跳过。
      skipIfExists: false,
    });
    if (incremental && typeof written === "number") {
      console.log(`[${key}] → agents/${agents} commands/${commands} (+${written} 更新)`);
    } else {
      console.log(`[${key}] → agents/${agents} commands/${commands}`);
    }
  }
}
