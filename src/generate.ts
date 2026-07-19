/**
 * 生成编排：domain 模式用模板+领域映射渲染；无 domain 用模板+角色名直出。
 *
 * 导出内部渲染管线供 validate.ts 复用，避免双重实现导致的不一致。
 * 支持增量模式：仅重写内容变化的文件。
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { PLATFORMS, type Family, type Platform } from "./platforms.js";
import { AGENTS, COMMANDS, AGENT_ROLES, COMMAND_ROLES } from "./registry.js";
import { loadAgentTemplates, loadCommandTemplates, loadTemplateFiles, renderTemplate } from "./template.js";
import { parseSource } from "./frontmatter.js";
import { resolveDomains, findDomain } from "./domain-loader.js";
import { NamedRenderer } from "./render/named.js";
import { ModeRenderer } from "./render/mode.js";
import { CodeBuddyRenderer } from "./render/codebuddy.js";
import { TraeRenderer } from "./render/trae.js";
import type { AgentSource, CommandSource, Renderer } from "./render/types.js";
import {
  loadManifest,
  saveManifest,
  detectChanges,
  applyChanges,
  type Manifest,
} from "./incremental.js";

const DEFAULT_TEMPLATES_ROOT = ".opencode/templates";

const RENDERERS: Record<Family, Renderer> = {
  named: new NamedRenderer(),
  mode: new ModeRenderer(),
  codebuddy: new CodeBuddyRenderer(),
  trae: new TraeRenderer(),
};

// ── 内部类型 ──

export interface RenderedAgent {
  name: string;
  content: string;
}

export interface RenderedCommand {
  name: string;
  content: string;
}

interface SourceEntry {
  role: string;
  key: string;
  description: string;
  backpressure?: import("./domain-schema.js").BackpressureConfig;
}

// ── Backpressure 渲染 ──

import type { BackpressureConfig } from "./domain-schema.js";

/** 把 backpressure 配置渲染成 markdown 段落；空配置返回空字符串。 */
export function renderBackpressure(bp: BackpressureConfig | undefined): string {
  if (!bp) return "";
  const retry = bp.retry_on_failure ? "重试一次后再判失败" : "立即判失败";
  return [
    "## 背压（断路器）",
    "",
    `- 验证命令：\`${bp.command}\``,
    `- 最大失败次数：${bp.max_failures}`,
    `- 失败处理：${retry}`,
    "",
    "每个执行轮次必须运行验证命令：",
    "- 通过：继续下一轮",
    `- 连续 ${bp.max_failures} 次失败：触发 ESCALATE 停止条件`,
  ].join("\n");
}

// ── 导出：纯渲染管线（不写盘） ──

export function renderAgent(
  platformKey: string,
  agentName: string,
  description: string,
  roleHint?: string,
  templatesRoot = DEFAULT_TEMPLATES_ROOT,
  cwd = process.cwd(),
  domainId?: string,
  backpressureText = "",
): RenderedAgent {
  const platform: Platform = PLATFORMS[platformKey];
  if (!platform) throw new Error(`未知平台: ${platformKey}`);

  const renderer = RENDERERS[platform.family];
  const templatesBase = join(cwd, templatesRoot);
  const userAgentTemplates = loadTemplateFiles(join(templatesBase, "agents"));
  const pkgAgentTemplates = loadAgentTemplates();
  const agentTemplates = { ...pkgAgentTemplates, ...userAgentTemplates };

  const role = roleHint || findAgentRole(agentName);
  const tpl = pickTemplate(agentTemplates, domainId, role);
  if (!tpl) throw new Error(`未找到角色模板: ${role}`);

  const rendered = renderTemplate(tpl, { name: agentName, description, backpressure: backpressureText });
  const { frontmatter, body } = parseSource(rendered);
  const src: AgentSource = { name: agentName, description, frontmatter, body };
  const content = renderer.renderAgent(src, platform);
  return { name: agentName, content };
}

export function renderCommand(
  platformKey: string,
  commandName: string,
  description: string,
  templatesRoot = DEFAULT_TEMPLATES_ROOT,
  cwd = process.cwd(),
  domainId?: string,
): RenderedCommand {
  const platform: Platform = PLATFORMS[platformKey];
  if (!platform) throw new Error(`未知平台: ${platformKey}`);

  const renderer = RENDERERS[platform.family];
  const templatesBase = join(cwd, templatesRoot);
  const userCommandTemplates = loadTemplateFiles(join(templatesBase, "commands"));
  const pkgCommandTemplates = loadCommandTemplates();
  const commandTemplates = { ...pkgCommandTemplates, ...userCommandTemplates };

  const role = findCommandRole(commandName);
  const tpl = pickTemplate(commandTemplates, domainId, role);
  if (!tpl) throw new Error(`未找到命令模板: ${role}`);

  const commandAgent = commandName.endsWith("-loop")
    ? `${commandName.slice(0, -5)}-orchestrator`
    : `${commandName}-orchestrator`;
  const rendered = renderTemplate(tpl, { name: commandName, description, agent: commandAgent });
  const { frontmatter, body } = parseSource(rendered);
  const src: CommandSource = { name: commandName, description, frontmatter, body };
  const content = renderer.renderCommand(src, platform);
  return { name: commandName, content };
}

function findAgentRole(name: string): string {
  // Exact match
  if (AGENT_ROLES.includes(name)) return name;
  // Try suffix match (e.g., "code-executor" → "executor")
  const parts = name.split("-");
  for (let i = parts.length - 1; i >= 0; i--) {
    if (AGENT_ROLES.includes(parts[i])) return parts[i];
  }
  // Try prefix match (e.g., "test-orchestrator" → "orchestrator")
  if (parts.length > 1 && AGENT_ROLES.includes(parts[0])) return parts[0];
  // Fallback
  return "orchestrator";
}

function findCommandRole(name: string): string {
  if (name === "loop") return "loop";
  if (name.includes("-loop")) return "loop";
  return "loop";
}

/**
 * 按领域优先级挑选模板：先查 `<domainId>-<role>`（如 `ralph-orchestrator`），
 * 找不到再回退到通用 `<role>`（如 `orchestrator`）。
 *
 * 这样 ralph 这类有专属工作流的领域可以用独立模板，其他领域共享通用模板。
 */
function pickTemplate(
  templates: Record<string, string>,
  domainId: string | undefined,
  role: string,
): string | undefined {
  if (domainId) {
    const specific = templates[`${domainId}-${role}`];
    if (specific) return specific;
  }
  return templates[role];
}

// ── 生成编排 ──

export function generatePlatform(
  platformKey: string,
  dryRun = false,
  templatesRoot = DEFAULT_TEMPLATES_ROOT,
  domain?: string,
  domainFiles: string[] = [],
  incremental = false,
  cwd = process.cwd(),
): { agents: number; commands: number; written?: number } {
  const platform: Platform = PLATFORMS[platformKey];
  if (!platform) throw new Error(`未知平台: ${platformKey}`);

  const renderer = RENDERERS[platform.family];
  const base = join(cwd, platform.dir);
  const agentsDir = join(base, "agents");
  const commandsDir = join(base, "commands");
  try {
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(commandsDir, { recursive: true });
  } catch (err) {
    throw new Error(`无法创建输出目录 (${platform.dir}): ${(err as Error).message}`);
  }

  const templatesBase = join(cwd, templatesRoot);
  const userAgentTemplates = loadTemplateFiles(join(templatesBase, "agents"));
  const userCommandTemplates = loadTemplateFiles(join(templatesBase, "commands"));
  const pkgAgentTemplates = loadAgentTemplates();
  const pkgCommandTemplates = loadCommandTemplates();
  const agentTemplates = { ...pkgAgentTemplates, ...userAgentTemplates };
  const commandTemplates = { ...pkgCommandTemplates, ...userCommandTemplates };

  const resolvedDomains = resolveDomains(domainFiles);
  const resolvedDomain = domain ? findDomain(resolvedDomains, domain) : undefined;

  // 收集所有预期文件
  const expectedFiles = new Map<string, string>();
  let agentCount = 0;
  const agentEntries: SourceEntry[] = resolvedDomain
    ? resolvedDomain.agents.map((a) => ({ role: a.role, key: a.name, description: a.description }))
    : AGENT_ROLES.map((role) => ({
        role,
        key: AGENTS[role].description ? role : role,
        description: AGENTS[role].description,
      }));

  for (const { role, key, description } of agentEntries) {
    const tpl = pickTemplate(agentTemplates, resolvedDomain?.id, role);
    if (!tpl) continue;
    // orchestrator 角色注入 backpressure 段；其他角色传空
    const backpressureText = role === "orchestrator" ? renderBackpressure(resolvedDomain?.backpressure) : "";
    const rendered = renderTemplate(tpl, { name: key, description, backpressure: backpressureText });
    const { frontmatter, body } = parseSource(rendered);
    const src: AgentSource = { name: key, description, frontmatter, body };
    const out = renderer.renderAgent(src, platform);
    const relativePath = `agents/${key}.md`;
    expectedFiles.set(relativePath, out);
    agentCount++;
  }

  let commandCount = 0;
  const commandEntries: SourceEntry[] = resolvedDomain
    ? resolvedDomain.commands.map((c) => ({ role: c.role, key: c.name, description: c.description }))
    : COMMAND_ROLES.map((role) => ({
        role,
        key: role,
        description: COMMANDS[role].description,
      }));

  for (const { role, key, description } of commandEntries) {
    const tpl = pickTemplate(commandTemplates, resolvedDomain?.id, role);
    if (!tpl) continue;
    const commandAgent = key.endsWith("-loop") ? `${key.slice(0, -5)}-orchestrator` : `${key}-orchestrator`;
    const rendered = renderTemplate(tpl, { name: key, description, agent: commandAgent });
    const { frontmatter, body } = parseSource(rendered);
    const src: CommandSource = { name: key, description, frontmatter, body };
    const out = renderer.renderCommand(src, platform);
    const relativePath = `commands/${key}.md`;
    expectedFiles.set(relativePath, out);
    commandCount++;
  }

  if (dryRun) {
    for (const [relPath] of expectedFiles) {
      console.log(`[dry-run] 将写入 ${join(platform.dir, relPath)}`);
    }
    return { agents: agentCount, commands: commandCount };
  }

  // ── 增量模式 ──
  if (incremental) {
    const manifest = loadManifest(platformKey, cwd);
    const changes = detectChanges(base, expectedFiles, manifest);
    const written = applyChanges(changes, manifest);
    saveManifest(platformKey, manifest, cwd);
    return { agents: agentCount, commands: commandCount, written };
  }

  // ── 全量模式（原有逻辑） ──
  for (const [relativePath, content] of expectedFiles) {
    const path = join(base, relativePath);
    try {
      writeFileSync(path, content, "utf-8");
    } catch (err) {
      throw new Error(`写入失败 ${path}: ${(err as Error).message}`);
    }
  }

  return { agents: agentCount, commands: commandCount };
}
