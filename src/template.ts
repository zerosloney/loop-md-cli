import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface TemplateVars {
  [key: string]: string;
}

const HERE = fileURLToPath(new URL(".", import.meta.url));

/**
 * 解析包内模板根目录，用存在性探测代替固定相对路径，避免 pnpm / yarn PnP 等
 * 非标准目录结构下失效：
 *   1. dist/templates —— 构建产物（build 脚本从 src/templates 复制而来），生产环境命中；
 *   2. ../src/templates —— 仓库布局，开发/测试环境（tsc 不复制 .md）回退命中。
 * 两者皆无时返回 dist/templates 路径，loadTemplateFiles 会静默返回空。
 */
function resolvePackageTemplatesRoot(): string {
  const built = join(HERE, "templates");
  if (existsSync(built)) return built;
  return join(HERE, "..", "src", "templates");
}

const PACKAGE_TEMPLATES_ROOT = resolvePackageTemplatesRoot();

export function loadTemplateFiles(dir: string): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".md")) continue;
      const name = entry.slice(0, -3);
      result[name] = readFileSync(join(dir, entry), "utf-8");
    }
  } catch {
    // 目录不存在或无权限，静默返回空
  }
  return result;
}

export function loadAgentTemplates(): Record<string, string> {
  return loadTemplateFiles(join(PACKAGE_TEMPLATES_ROOT, "agents"));
}

export function loadCommandTemplates(): Record<string, string> {
  return loadTemplateFiles(join(PACKAGE_TEMPLATES_ROOT, "commands"));
}

export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return key in vars ? vars[key] : match;
  });
}
