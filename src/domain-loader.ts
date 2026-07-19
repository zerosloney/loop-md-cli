import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { DOMAINS } from "./domains.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PACKAGE_DOMAINS_ROOT = join(HERE, "..", "src", "domains");

export interface ResolvedDomain {
  id: string;
  agents: { role: string; name: string; description: string }[];
  commands: { role: string; name: string; description: string }[];
}

function readDomainFile(path: string): ResolvedDomain {
  const raw = readFileSync(path, "utf-8");
  const json = JSON.parse(raw) as ResolvedDomain;
  if (!json.id || !Array.isArray(json.agents) || !Array.isArray(json.commands)) {
    throw new Error(`领域文件格式无效 (${path}); 需要 id/agents/commands`);
  }
  return json;
}

function loadBuiltinDomains(): ResolvedDomain[] {
  return Object.values(DOMAINS).map((d) => ({
    id: d.id,
    agents: d.agents.map((a) => ({ role: a.role, name: a.name, description: a.description })),
    commands: d.commands.map((c) => ({ role: c.role, name: c.name, description: c.description })),
  }));
}

function loadProjectDomains(): ResolvedDomain[] {
  const result: ResolvedDomain[] = [];
  try {
    const entries = readdirSync(PACKAGE_DOMAINS_ROOT);
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const path = join(PACKAGE_DOMAINS_ROOT, entry);
      try {
        result.push(readDomainFile(path));
      } catch (err) {
        console.error(`警告:无法加载领域文件 ${path}: ${(err as Error).message}`);
      }
    }
  } catch {
    // 目录不存在，静默返回空
  }
  return result;
}

function loadDomainFile(path: string): ResolvedDomain {
  try {
    return readDomainFile(path);
  } catch (err) {
    throw new Error(`无法加载领域文件 ${path}: ${(err as Error).message}`);
  }
}

export function resolveDomains(extraFiles: string[] = []): ResolvedDomain[] {
  const map = new Map<string, ResolvedDomain>();

  for (const d of loadBuiltinDomains()) {
    map.set(d.id, d);
  }
  for (const d of loadProjectDomains()) {
    map.set(d.id, d);
  }
  for (const file of extraFiles) {
    const d = loadDomainFile(file);
    map.set(d.id, d);
  }

  return Array.from(map.values());
}

export function findDomain(domains: ResolvedDomain[], id: string): ResolvedDomain {
  const found = domains.find((d) => d.id === id);
  if (!found) {
    const builtin = Object.keys(DOMAINS).join(", ");
    throw new Error(`未知领域: ${id}。支持的内置领域: ${builtin}`);
  }
  return found;
}
