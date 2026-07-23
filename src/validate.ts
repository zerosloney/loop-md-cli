/**
 * 验证模式：将磁盘上的 agent/command 文件与当前模板渲染的预期输出逐文件对比。
 *
 * 复用 generate.ts 的渲染管线，确保预期输出与实际生成完全一致。
 *
 * 报告四类问题：
 *   stale    — 文件存在但内容不一致
 *   missing  — 预期存在但磁盘上没有
 *   extra    — 磁盘上有但预期不存在的文件
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { PLATFORMS, type Platform } from "./platforms.js";
import { resolveDomains, findDomain } from "./domain-loader.js";
import { DEFAULT_DOMAIN_ID } from "./registry.js";
import { loadAgentTemplates, loadCommandTemplates, loadTemplateFiles } from "./template.js";
import {
  renderAgentWithTemplates,
  renderCommandWithTemplates,
  RENDERERS,
  renderBackpressure,
  type RenderedAgent,
  type RenderedCommand,
} from "./generate.js";

// ── 验证结果 ──

export interface FileIssue {
  path: string;
  type: "stale" | "missing" | "extra";
  message: string;
}

export interface ValidateResult {
  platform: string;
  domain?: string;
  totalExpected: number;
  issues: FileIssue[];
  issueCount: number;
  clean: boolean;
}

// ── 内部：扫描磁盘 .md 文件 ──

function scanMdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();
}

// ── 内部：对比单文件内容 ──

function compareFile(expected: string, actualPath: string): string | null {
  try {
    const actual = readFileSync(actualPath, "utf-8");
    // 统一换行符再比较：生成产物按 LF 写盘，但 Windows 上 git autocrlf / 编辑器
    // 可能把磁盘文件转成 CRLF，不归一化会产生大量 stale 误报。
    const normExpected = expected.replace(/\r\n/g, "\n");
    const normActual = actual.replace(/\r\n/g, "\n");
    if (normActual === normExpected) return null;
    const expLines = normExpected.split("\n");
    const actLines = normActual.split("\n");
    const minLen = Math.min(expLines.length, actLines.length);
    for (let i = 0; i < minLen; i++) {
      if (expLines[i] !== actLines[i]) {
        const expLine = expLines[i].length > 80 ? expLines[i].slice(0, 80) + "..." : expLines[i];
        const actLine = actLines[i].length > 80 ? actLines[i].slice(0, 80) + "..." : actLines[i];
        return `第 ${i + 1} 行不一致\n  - 预期: ${expLine}\n  + 实际: ${actLine}`;
      }
    }
    return `行数不一致: 预期 ${expLines.length} 行, 实际 ${actLines.length} 行`;
  } catch {
    return "无法读取文件";
  }
}

// ── 主入口 ──

export function validatePlatform(
  platformKey: string,
  templatesRoot = ".opencode/templates",
  domains?: string | string[],
  domainFiles: string[] = [],
  cwd = process.cwd(),
): ValidateResult {
  const platform: Platform = PLATFORMS[platformKey];
  if (!platform) throw new Error(`未知平台: ${platformKey}`);

  const base = join(cwd, platform.dir);
  const agentsDir = join(base, "agents");
  const commandsDir = join(base, "commands");

  const resolvedDomainsPool = resolveDomains(domainFiles, cwd);
  // domains 支持单字符串（向后兼容）或数组；都为空时回退 ralph 内核范式
  const domainList = Array.isArray(domains) ? domains : domains ? [domains] : [];
  const effectiveDomainIds = domainList.length > 0 ? domainList : [DEFAULT_DOMAIN_ID];

  // ── 加载模板（一次加载，避免 loops 内重复读盘） ──
  const renderer = RENDERERS[platform.family];
  const templatesBase = join(cwd, templatesRoot);
  const userAgentTemplates = loadTemplateFiles(join(templatesBase, "agents"));
  const pkgAgentTemplates = loadAgentTemplates();
  const agentTemplates = { ...pkgAgentTemplates, ...userAgentTemplates };
  const userCommandTemplates = loadTemplateFiles(join(templatesBase, "commands"));
  const pkgCommandTemplates = loadCommandTemplates();
  const commandTemplates = { ...pkgCommandTemplates, ...userCommandTemplates };

  const issues: FileIssue[] = [];

  // ── 遍历所有领域，合并预期 agent + command 列表 ──
  const expectedAgents: RenderedAgent[] = [];
  const expectedCommands: RenderedCommand[] = [];

  for (const domainId of effectiveDomainIds) {
    const resolvedDomain = findDomain(resolvedDomainsPool, domainId);
    const renderDomainId = resolvedDomain.id;
    const bpText = renderBackpressure(resolvedDomain.backpressure);

    for (const a of resolvedDomain.agents) {
      const agentBp = a.role === "orchestrator" ? bpText : "";
      expectedAgents.push(
        renderAgentWithTemplates(
          renderer,
          platform,
          a.name,
          a.description,
          a.role,
          agentTemplates,
          renderDomainId,
          agentBp,
          a.model,
          resolvedDomain.engine.type,
        ),
      );
    }

    const executorName = resolvedDomain.agents.find((a) => a.role === "executor")?.name ?? "";
    const reviewerName = resolvedDomain.agents.find((a) => a.role === "reviewer")?.name ?? "";
    for (const c of resolvedDomain.commands) {
      expectedCommands.push(
        renderCommandWithTemplates(
          renderer,
          platform,
          c.name,
          c.description,
          c.agent,
          commandTemplates,
          renderDomainId,
          resolvedDomain.engine.type,
          resolvedDomain.tasks,
          executorName,
          reviewerName,
        ),
      );
    }
  }

  // ── 扫描磁盘 agent 文件 ──
  const diskAgentFiles = scanMdFiles(agentsDir);
  const expectedAgentNames = new Set(expectedAgents.map((a) => `${a.name}.md`));

  for (const agent of expectedAgents) {
    const fileName = `${agent.name}.md`;
    const filePath = join(agentsDir, fileName);
    if (!diskAgentFiles.includes(fileName)) {
      issues.push({ path: filePath, type: "missing", message: "预期文件不存在于磁盘" });
    } else {
      const diff = compareFile(agent.content, filePath);
      if (diff) {
        issues.push({ path: filePath, type: "stale", message: diff });
      }
    }
  }

  for (const file of diskAgentFiles) {
    if (!expectedAgentNames.has(file)) {
      issues.push({
        path: join(agentsDir, file),
        type: "extra",
        message: "磁盘上存在但预期中无此文件",
      });
    }
  }

  // ── 扫描磁盘 command 文件 ──
  const diskCommandFiles = scanMdFiles(commandsDir);
  const expectedCommandNames = new Set(expectedCommands.map((c) => `${c.name}.md`));

  for (const cmd of expectedCommands) {
    const fileName = `${cmd.name}.md`;
    const filePath = join(commandsDir, fileName);
    if (!diskCommandFiles.includes(fileName)) {
      issues.push({ path: filePath, type: "missing", message: "预期文件不存在于磁盘" });
    } else {
      const diff = compareFile(cmd.content, filePath);
      if (diff) {
        issues.push({ path: filePath, type: "stale", message: diff });
      }
    }
  }

  for (const file of diskCommandFiles) {
    if (!expectedCommandNames.has(file)) {
      issues.push({
        path: join(commandsDir, file),
        type: "extra",
        message: "磁盘上存在但预期中无此文件",
      });
    }
  }

  const totalExpected = expectedAgents.length + expectedCommands.length;

  return {
    platform: platformKey,
    domain: effectiveDomainIds.length > 0 ? effectiveDomainIds.join(", ") : undefined,
    totalExpected,
    issues,
    issueCount: issues.length,
    clean: issues.length === 0,
  };
}

// ── 格式化输出 ──

export function formatValidateResult(result: ValidateResult): string {
  const lines: string[] = [];
  lines.push(`验证平台: ${result.platform}${result.domain ? ` (领域: ${result.domain})` : ""}`);
  lines.push(`预期文件: ${result.totalExpected} 个`);

  if (result.clean) {
    lines.push("状态: ✅ 全部一致，无需更新");
  } else {
    lines.push(`状态: ❌ 发现 ${result.issueCount} 个问题`);
    lines.push("");

    const stale = result.issues.filter((i) => i.type === "stale");
    const missing = result.issues.filter((i) => i.type === "missing");
    const extra = result.issues.filter((i) => i.type === "extra");

    if (stale.length > 0) {
      lines.push(`  已过期 (${stale.length}):`);
      for (const issue of stale) {
        lines.push(`    ❌ ${issue.path}`);
        lines.push(`       ${issue.message}`);
      }
    }

    if (missing.length > 0) {
      lines.push(`  缺失 (${missing.length}):`);
      for (const issue of missing) {
        lines.push(`    ❌ ${issue.path}`);
        lines.push(`       ${issue.message}`);
      }
    }

    if (extra.length > 0) {
      lines.push(`  多余 (${extra.length}):`);
      for (const issue of extra) {
        lines.push(`    ⚠️  ${issue.path}`);
        lines.push(`       ${issue.message}`);
      }
    }
  }

  return lines.join("\n");
}
