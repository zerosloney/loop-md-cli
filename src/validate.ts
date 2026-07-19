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
import { renderAgent, renderCommand, renderBackpressure, type RenderedAgent, type RenderedCommand } from "./generate.js";

// ── 验证结果 ──

export interface FileIssue {
  path: string;
  type: "stale" | "extra" | "missing";
  message: string;
}

export interface ValidateResult {
  platform: string;
  domain?: string;
  totalExpected: number;
  issues: FileIssue[];
  /** 0 = 无问题，>0 = 有问题 */
  issueCount: number;
  /** 所有平台都干净才为 true */
  clean: boolean;
}

// ── 内部：扫描磁盘 .md 文件 ──

function scanMdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
}

// ── 内部：对比单文件内容 ──

function compareFile(expected: string, actualPath: string): string | null {
  try {
    const actual = readFileSync(actualPath, "utf-8");
    if (actual === expected) return null;
    const expLines = expected.split("\n");
    const actLines = actual.split("\n");
    const minLen = Math.min(expLines.length, actLines.length);
    for (let i = 0; i < minLen; i++) {
      if (expLines[i] !== actLines[i]) {
        return `第 ${i + 1} 行不一致`;
      }
    }
    return expLines.length !== actLines.length ? "行数不一致" : null;
  } catch {
    return "无法读取文件";
  }
}

// ── 主入口 ──

export function validatePlatform(
  platformKey: string,
  templatesRoot = ".opencode/templates",
  domain?: string,
  domainFiles: string[] = [],
  cwd = process.cwd(),
): ValidateResult {
  const platform: Platform = PLATFORMS[platformKey];
  if (!platform) throw new Error(`未知平台: ${platformKey}`);

  const base = join(cwd, platform.dir);
  const agentsDir = join(base, "agents");
  const commandsDir = join(base, "commands");

  const resolvedDomains = resolveDomains(domainFiles);
  // 无 domain 时用默认虚拟领域（与 generate.ts 的 defaultDomain 同步）：
  // renderDomainId 传 undefined，renderedCommand 时 engineType 显式给 "loop"。
  // 这里用 null 表示"无领域"分支，让两个路径走相同的渲染调用样式。
  const resolvedDomain = domain ? findDomain(resolvedDomains, domain) : null;
  // 实际渲染用的领域 id（无 domain 时传 undefined，让模板用通用版本）
  const renderDomainId = resolvedDomain?.id === "__default__" ? undefined : resolvedDomain?.id;

  const issues: FileIssue[] = [];

  // ── 生成预期 agent 列表 ──
  // 注意：渲染必须与 generate.ts 的 generatePlatform 完全一致，包括 backpressure 注入，
  // 否则 validate 会误报 stale。orchestrator 角色注入断路器段，其他角色传空。
  const bpText = renderBackpressure(resolvedDomain?.backpressure);
  const expectedAgents: RenderedAgent[] = [];
  if (resolvedDomain) {
    for (const a of resolvedDomain.agents) {
      const agentBp = a.role === "orchestrator" ? bpText : "";
      expectedAgents.push(renderAgent(platformKey, a.name, a.description, a.role, templatesRoot, cwd, renderDomainId, agentBp));
    }
  } else {
    // 无 domain 时使用角色名作为名称
    const agentRoles = ["orchestrator", "executor", "reviewer"];
    for (const role of agentRoles) {
      const desc = role === "orchestrator"
        ? "Loop 主控 Agent。规划执行边界、委派执行者/审查者，根据真实门禁决定停止。"
        : role === "executor"
          ? "Loop 执行者 Agent。在声明边界内执行业务产出，按根因分组修改并运行真实验证。"
          : "Loop 只读质量阀。复核执行者产出与变更，输出可机器路由的 JSON verdict/issues。";
      expectedAgents.push(renderAgent(platformKey, role, desc, undefined, templatesRoot, cwd));
    }
  }

  const expectedCommands: RenderedCommand[] = [];
  if (resolvedDomain) {
    for (const c of resolvedDomain.commands) {
      expectedCommands.push(
        renderCommand(platformKey, c.name, c.description, c.agent, templatesRoot, cwd, renderDomainId, resolvedDomain.engine.type),
      );
    }
  } else {
    // 无 domain 时使用默认 command (loop 入口 → orchestrator)
    expectedCommands.push(
      renderCommand(platformKey, "loop", "Loop 闭环命令。规划边界、委派执行者/审查者，按完成标准决定停止。", "orchestrator", templatesRoot, cwd),
    );
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
      issues.push({ path: join(agentsDir, file), type: "extra", message: "磁盘上存在但预期中无此文件" });
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
      issues.push({ path: join(commandsDir, file), type: "extra", message: "磁盘上存在但预期中无此文件" });
    }
  }

  const totalExpected = expectedAgents.length + expectedCommands.length;

  return {
    platform: platformKey,
    domain,
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
