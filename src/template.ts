import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface TemplateVars {
  [key: string]: string;
}

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PACKAGE_TEMPLATES_ROOT = join(HERE, "..", "src", "templates");

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
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}
