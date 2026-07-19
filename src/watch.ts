/**
 * watch 模式：监听模板和领域文件变化，自动重新生成。
 *
 * 使用 Node.js 原生 fs.watchFile（兼容所有平台，包括 Windows）。
 * 防抖策略：同一文件 300ms 内的多次修改只触发一次生成。
 */
import { watchFile, unwatchFile, existsSync, readdirSync } from "node:fs";
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
 * @param domain 领域 ID
 * @param domainFiles 自定义领域文件路径
 * @param cwd 工作目录，默认为 process.cwd()
 */
export function startWatch(
  platforms: string[],
  domain?: string,
  domainFiles: string[] = [],
  cwd = process.cwd(),
): () => void {
  const debouncer = new Debouncer(() => {
    runGeneration(platforms, domain, domainFiles, cwd);
  }, 300);

  const watchedFiles: string[] = [];

  // 监听模板目录
  const templatesBase = join(cwd, DEFAULT_TEMPLATES_ROOT);
  const watchTemplateDir = (subdir: string) => {
    const dir = join(templatesBase, subdir);
    if (!existsSync(dir)) return;
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const fullPath = join(dir, file);
      watchFile(fullPath, () => {
        debouncer.trigger();
      });
      watchedFiles.push(fullPath);
    }
  };
  watchTemplateDir("agents");
  watchTemplateDir("commands");

  // 监听自定义领域文件
  for (const file of domainFiles) {
    watchFile(file, () => {
      debouncer.trigger();
    });
    watchedFiles.push(file);
  }

  // 初始生成
  console.log("👀 监听模板和领域文件变化...");
  console.log(`   平台: ${platforms.join(", ")}`);
  if (domain) console.log(`   领域: ${domain}`);
  console.log("   按 Ctrl+C 退出\n");
  runGeneration(platforms, domain, domainFiles, cwd);

  // 返回清理函数
  return () => {
    debouncer.dispose();
    for (const file of watchedFiles) {
      try {
        unwatchFile(file);
      } catch {
        // ignore
      }
    }
  };
}

function runGeneration(platforms: string[], domain?: string, domainFiles: string[] = [], cwd = process.cwd()): void {
  for (const key of platforms) {
    const { agents, commands } = generatePlatform(key, false, DEFAULT_TEMPLATES_ROOT, domain, domainFiles, false, cwd);
    console.log(`[${key}] → agents/${agents} commands/${commands}`);
  }
}
