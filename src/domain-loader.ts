/**
 * 领域加载器：
 *   1. 从 domains.ts 加载内置领域
 *   2. 自动扫描 {cwd}/.opencode/domains/*.json（团队共享领域，被 git 追踪）
 *   3. 从 CLI 传入的 --domain-file 加载自定义领域
 *
 * 加载顺序决定覆盖优先级（按 id 去重，后者覆盖前者）：
 *   内置 → .opencode/domains/ 扫描 → --domain-file 显式传入
 *
 * 设计目的：把"团队共享领域文件"和"工具自己的 manifest 缓存"物理隔离——
 * 领域文件放 .opencode/domains/（与模板同根，提交进 git），
 * manifest 缓存放 .loop-forge/cache/（成员本机，gitignore）。
 */

import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { DOMAINS } from "./domains.js";
import { readDomainFile, type ResolvedDomain } from "./domain-schema.js";

/** 自动扫描的团队共享领域目录（相对 cwd）。 */
export const DOMAINS_DIR = ".opencode/domains";

function loadBuiltinDomains(): ResolvedDomain[] {
  return Object.values(DOMAINS).map((d) => ({
    id: d.id,
    engine: { ...d.engine },
    agents: d.agents.map((a) => ({ role: a.role, name: a.name, description: a.description })),
    commands: d.commands.map((c) => ({ kind: c.kind, agent: c.agent, name: c.name, description: c.description })),
    backpressure: d.backpressure,
  }));
}

/** 扫描 {cwd}/.opencode/domains/*.json，返回成功解析的领域列表。坏文件打 stderr 警告但不抛。 */
function scanDomainDir(cwd: string): ResolvedDomain[] {
  const dir = join(cwd, DOMAINS_DIR);
  if (!existsSync(dir)) return [];
  const result: ResolvedDomain[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    console.error(`[domain-loader] 无法读取领域目录 ${dir}: ${(err as Error).message}`);
    return [];
  }
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const fullPath = join(dir, entry);
    try {
      result.push(readDomainFile(fullPath));
    } catch (err) {
      // 单个坏文件不致命：跳过但让用户看到
      console.error(`[domain-loader] 跳过无效领域文件 ${entry}: ${(err as Error).message.split("\n")[0]}`);
    }
  }
  return result;
}

/**
 * 合并三个来源的领域：内置 → .opencode/domains/ 自动扫描 → --domain-file 显式传入。
 * 后者按 id 覆盖前者。cwd 默认 process.cwd()。
 */
export function resolveDomains(extraFiles: string[] = [], cwd = process.cwd()): ResolvedDomain[] {
  const map = new Map<string, ResolvedDomain>();

  for (const d of loadBuiltinDomains()) {
    map.set(d.id, d);
  }
  for (const d of scanDomainDir(cwd)) {
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
