/**
 * 领域加载器：从 domains.ts 加载内置领域，从 CLI 传入的 JSON 文件加载自定义领域。
 */

import { DOMAINS } from "./domains.js";
import { readDomainFile, type ResolvedDomain } from "./domain-schema.js";

function loadBuiltinDomains(): ResolvedDomain[] {
  return Object.values(DOMAINS).map((d) => ({
    id: d.id,
    agents: d.agents.map((a) => ({ role: a.role, name: a.name, description: a.description })),
    commands: d.commands.map((c) => ({ role: c.role, name: c.name, description: c.description })),
    backpressure: d.backpressure,
  }));
}

export function resolveDomains(extraFiles: string[] = []): ResolvedDomain[] {
  const map = new Map<string, ResolvedDomain>();

  for (const d of loadBuiltinDomains()) {
    map.set(d.id, d);
  }
  for (const file of extraFiles) {
    const d = readDomainFile(file);
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
