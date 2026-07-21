/**
 * 生成编排：domain 模式用模板+领域映射渲染；无 domain 用模板+角色名直出。
 *
 * 导出内部渲染管线供 validate.ts 复用，避免双重实现导致的不一致。
 * 支持增量模式：仅重写内容变化的文件。
 *
 * 概念分层：
 *   engine.type (= "loop") → 决定 command 模板 lookup 域
 *   commands[].agent       → 决定 command 模板里 {{agent}} 的取值
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PLATFORMS, type Family, type Platform } from "./platforms.js";
import { ENGINE_TYPES, DEFAULT_DOMAIN_ID } from "./registry.js";
import { loadAgentTemplates, loadCommandTemplates, loadTemplateFiles, renderTemplate } from "./template.js";
import { parseSource } from "./frontmatter.js";
import { resolveDomains, findDomain } from "./domain-loader.js";
import { findAgentRole } from "./roles.js";
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
import type { BackpressureConfig, ResolvedDomain } from "./domain-schema.js";

const DEFAULT_TEMPLATES_ROOT = ".opencode/templates";

export const RENDERERS: Record<Family, Renderer> = {
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

interface AgentSourceEntry {
  role: string;
  key: string;
  description: string;
  model?: string;
}

interface CommandSourceEntry {
  /** 模板 lookup key（即 engine.type，例如 "loop"）。 */
  engineType: string;
  key: string;
  description: string;
  /** command 模板里 {{agent}} 的取值（command.agent 显式声明）。 */
  agent: string;
}

// ── Backpressure 渲染 ──

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

/** 内部：用预加载模板渲染 agent，供 validate.ts 复用避免重复读盘。 */
export function renderAgentWithTemplates(
  renderer: Renderer,
  platform: Platform,
  agentName: string,
  description: string,
  role: string,
  agentTemplates: Record<string, string>,
  domainId?: string,
  backpressureText = "",
  model?: string,
): RenderedAgent {
  const tpl = pickTemplate(agentTemplates, domainId, role);
  if (!tpl) throw new Error(`未找到角色模板: ${role}`);
  const vars: Record<string, string> = { name: agentName, description, backpressure: backpressureText };
  if (domainId) vars.domain = domainId;
  const rendered = renderTemplate(tpl, vars);
  const { frontmatter, body } = parseSource(rendered);
  const src: AgentSource = { name: agentName, description, frontmatter, body, role, model };
  const content = renderer.renderAgent(src, platform);
  return { name: agentName, content };
}

/** 内部：用预加载模板渲染 command，供 validate.ts 复用避免重复读盘。 */
export function renderCommandWithTemplates(
  renderer: Renderer,
  platform: Platform,
  commandName: string,
  description: string,
  agentName: string,
  commandTemplates: Record<string, string>,
  domainId?: string,
  engineType?: string,
): RenderedCommand {
  const effectiveEngineType = engineType ?? ENGINE_TYPES[0];
  const tpl = pickCommandTemplate(commandTemplates, domainId, effectiveEngineType);
  if (!tpl) throw new Error(`未找到命令模板: engine.type=${effectiveEngineType}${domainId ? ` (domain=${domainId})` : ""}`);
  const vars: Record<string, string> = { name: commandName, description, agent: agentName };
  if (domainId) vars.domain = domainId;
  const rendered = renderTemplate(tpl, vars);
  const { frontmatter, body } = parseSource(rendered);
  const src: CommandSource = { name: commandName, description, frontmatter, body };
  const content = renderer.renderCommand(src, platform);
  return { name: commandName, content };
}

export function renderAgent(
  platformKey: string,
  agentName: string,
  description: string,
  roleHint?: string,
  templatesRoot = DEFAULT_TEMPLATES_ROOT,
  cwd = process.cwd(),
  domainId?: string,
  backpressureText = "",
  model?: string,
): RenderedAgent {
  const platform: Platform = PLATFORMS[platformKey];
  if (!platform) throw new Error(`未知平台: ${platformKey}`);

  const renderer = RENDERERS[platform.family];
  const templatesBase = join(cwd, templatesRoot);
  const userAgentTemplates = loadTemplateFiles(join(templatesBase, "agents"));
  const pkgAgentTemplates = loadAgentTemplates();
  const agentTemplates = { ...pkgAgentTemplates, ...userAgentTemplates };
  const role = roleHint || findAgentRole(agentName);
  return renderAgentWithTemplates(renderer, platform, agentName, description, role, agentTemplates, domainId, backpressureText, model);
}

export function renderCommand(
  platformKey: string,
  commandName: string,
  description: string,
  agentName: string,
  templatesRoot = DEFAULT_TEMPLATES_ROOT,
  cwd = process.cwd(),
  domainId?: string,
  engineType?: string,
): RenderedCommand {
  const platform: Platform = PLATFORMS[platformKey];
  if (!platform) throw new Error(`未知平台: ${platformKey}`);

  const renderer = RENDERERS[platform.family];
  const templatesBase = join(cwd, templatesRoot);
  const userCommandTemplates = loadTemplateFiles(join(templatesBase, "commands"));
  const pkgCommandTemplates = loadCommandTemplates();
  const commandTemplates = { ...pkgCommandTemplates, ...userCommandTemplates };
  return renderCommandWithTemplates(renderer, platform, commandName, description, agentName, commandTemplates, domainId, engineType);
}

/**
 * 按领域优先级挑选 agent 模板，三级回退：
 *   1. `<domainId>-<role>`（如 `coding-orchestrator`）— 领域专属
 *   2. `ralph-<role>`（如 `ralph-orchestrator`）— 最通用的内核范式（自定义领域无专属模板时回退到此）
 *   3. 抛错（避免静默生成 0 文件）
 *
 * ralph 是 loop-md-cli 的内核范式（TaskList + 背压熔断），所有自定义领域都至少能回退到它。
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
  // 回退到 ralph-*（最通用的内核范式）
  const ralphFallback = templates[`ralph-${role}`];
  if (ralphFallback) return ralphFallback;
  return undefined;
}

/**
 * 选 command 模板，三级回退：`<domainId>-<engineType>` → `ralph-<engineType>` → 抛错。
 */
function pickCommandTemplate(
  templates: Record<string, string>,
  domainId: string | undefined,
  engineType: string,
): string | undefined {
  if (domainId) {
    const specific = templates[`${domainId}-${engineType}`];
    if (specific) return specific;
  }
  // 回退到 ralph-<engineType>（最通用的内核范式）
  const ralphFallback = templates[`ralph-${engineType}`];
  if (ralphFallback) return ralphFallback;
  return undefined;
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
  modelOverrides?: Record<string, string>,
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

  const resolvedDomains = resolveDomains(domainFiles, cwd);
  // 无 domain 时回退到 ralph 内核范式（DEFAULT_DOMAIN_ID）
  const effectiveDomainId = domain ?? DEFAULT_DOMAIN_ID;
  const resolvedDomain: ResolvedDomain = findDomain(resolvedDomains, effectiveDomainId);

  // 收集所有预期文件
  const expectedFiles = new Map<string, string>();
  let agentCount = 0;
  const agentEntries: AgentSourceEntry[] = resolvedDomain.agents.map((a) => ({
    role: a.role,
    key: a.name,
    description: a.description,
    model: modelOverrides?.[a.role] ?? a.model,
  }));

  for (const { role, key, description, model } of agentEntries) {
    const tpl = pickTemplate(agentTemplates, resolvedDomain.id, role);
    if (!tpl) {
      throw new Error(
        `未找到角色模板: ${role} (domain=${resolvedDomain.id})。预期文件 src/templates/agents/${resolvedDomain.id}-${role}.md 或 ${role}.md`,
      );
    }
    const backpressureText = role === "orchestrator" ? renderBackpressure(resolvedDomain.backpressure) : "";
    const agentVars: Record<string, string> = { name: key, description, backpressure: backpressureText };
    agentVars.domain = resolvedDomain.id;
    const rendered = renderTemplate(tpl, agentVars);
    const { frontmatter, body } = parseSource(rendered);
    const src: AgentSource = { name: key, description, frontmatter, body, role, model };
    const out = renderer.renderAgent(src, platform);
    const relativePath = `agents/${key}.md`;
    expectedFiles.set(relativePath, out);
    agentCount++;
  }

  let commandCount = 0;
  const commandEntries: CommandSourceEntry[] = resolvedDomain.commands.map((c) => ({
    engineType: resolvedDomain.engine.type,
    key: c.name,
    description: c.description,
    agent: c.agent,
  }));

  for (const { engineType, key, description, agent } of commandEntries) {
    const tpl = pickCommandTemplate(
      commandTemplates,
      resolvedDomain.id,
      engineType,
    );
    if (!tpl) {
      throw new Error(
        `未找到命令模板: engine.type=${engineType} (domain=${resolvedDomain.id})。预期文件 src/templates/commands/${resolvedDomain.id}-${engineType}.md 或 ${engineType}.md`,
      );
    }
    const cmdVars: Record<string, string> = { name: key, description, agent };
    cmdVars.domain = resolvedDomain.id;
    const rendered = renderTemplate(tpl, cmdVars);
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
