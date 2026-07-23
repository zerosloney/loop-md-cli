/**
 * 生成编排：domain 模式用模板+领域映射渲染；无 domain 用模板+角色名直出。
 *
 * 导出内部渲染管线供 validate.ts 复用，避免双重实现导致的不一致。
 * 支持增量模式：仅重写内容变化的文件。
 *
 * 概念分层：
 *   engine.type (= "loop" | "graph") → 决定 command 模板 lookup 域
 *   commands[].agent                 → 决定 command 模板里 {{agent}} 的取值
 */
import { mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { PLATFORMS, type Family, type Platform } from "./platforms.js";
import { ENGINE_TYPES, DEFAULT_DOMAIN_ID } from "./registry.js";
import {
  loadAgentTemplates,
  loadCommandTemplates,
  loadTemplateFiles,
  renderTemplate,
} from "./template.js";
import { parseSource } from "./frontmatter.js";
import { resolveDomains, findDomain } from "./domain-loader.js";
import { findAgentRole } from "./roles.js";
import { NamedRenderer } from "./render/named.js";
import { ModeRenderer } from "./render/mode.js";
import { CodeBuddyRenderer } from "./render/codebuddy.js";
import { TraeRenderer } from "./render/trae.js";
import { QwenRenderer } from "./render/qwen.js";
import type { AgentSource, CommandSource, Renderer } from "./render/types.js";
import {
  loadManifest,
  saveManifest,
  detectChanges,
  applyChanges,
  computeHash,
  writeAtomic,
} from "./incremental.js";
import type { BackpressureConfig, ResolvedDomain, TaskDefinition } from "./domain-schema.js";

const DEFAULT_TEMPLATES_ROOT = ".opencode/templates";

export const RENDERERS: Record<Family, Renderer> = {
  named: new NamedRenderer(),
  mode: new ModeRenderer(),
  codebuddy: new CodeBuddyRenderer(),
  trae: new TraeRenderer(),
  qwen: new QwenRenderer(),
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
  engineType?: string,
): RenderedAgent {
  const tpl = pickTemplate(agentTemplates, domainId, role);
  if (!tpl) throw new Error(`未找到角色模板: ${role}`);
  const vars: Record<string, string> = {
    name: agentName,
    description,
    backpressure: backpressureText,
  };
  if (domainId) vars.domain = domainId;
  // engine_type 必须与 generatePlatform 写盘路径一致，否则 validate 比对会误报 stale。
  // 默认 loop（与 ENGINE_TYPES[0] 一致），覆盖 renderAgent 公开 API 无 domain 上下文的场景。
  vars.engine_type = engineType ?? ENGINE_TYPES[0];
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
  tasks?: TaskDefinition[],
): RenderedCommand {
  const effectiveEngineType = engineType ?? ENGINE_TYPES[0];
  const tpl = pickCommandTemplate(commandTemplates, domainId, effectiveEngineType);
  if (!tpl)
    throw new Error(
      `未找到命令模板: engine.type=${effectiveEngineType}${domainId ? ` (domain=${domainId})` : ""}`,
    );
  const vars: Record<string, string> = { name: commandName, description, agent: agentName };
  if (domainId) vars.domain = domainId;
  // routing_table 必须与 generatePlatform 写盘路径一致，否则 validate 比对会误报 stale。
  if (effectiveEngineType === "graph" && tasks) {
    vars.routing_table = buildRoutingTable(tasks);
  }
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
  return renderAgentWithTemplates(
    renderer,
    platform,
    agentName,
    description,
    role,
    agentTemplates,
    domainId,
    backpressureText,
    model,
  );
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
  return renderCommandWithTemplates(
    renderer,
    platform,
    commandName,
    description,
    agentName,
    commandTemplates,
    domainId,
    engineType,
  );
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
  // 回退到 ralph-*（最通用的内核范式）。领域模板缺失通常是文件名拼写错误，给出可见警告便于定位。
  if (domainId) {
    console.warn(
      `[loop-md] 领域模板 ${domainId}-${role} 未找到，回退到 ralph-${role} 内核范式`,
    );
  }
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
  // 回退到 ralph-<engineType>（最通用的内核范式）。领域模板缺失通常是文件名拼写错误，给出可见警告便于定位。
  if (domainId) {
    console.warn(
      `[loop-md] 领域模板 ${domainId}-${engineType} 未找到，回退到 ralph-${engineType} 内核范式`,
    );
  }
  const ralphFallback = templates[`ralph-${engineType}`];
  if (ralphFallback) return ralphFallback;
  return undefined;
}

/**
 * 构建图模式的 DAG 路由表 JSON 字符串。
 * 根据 tasks 定义计算 entry_points、topological_order（Kahn 算法）和节点映射。
 */
export function buildRoutingTable(tasks: TaskDefinition[]): string {
  // 拓扑排序（Kahn 算法）
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const t of tasks) {
    adj.set(t.id, []);
    inDegree.set(t.id, 0);
  }
  for (const t of tasks) {
    for (const dep of t.depends_on ?? []) {
      const deps = adj.get(dep);
      if (deps) deps.push(t.id);
      inDegree.set(t.id, (inDegree.get(t.id) || 0) + 1);
    }
  }
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  const topologicalOrder: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    topologicalOrder.push(node);
    for (const next of adj.get(node) ?? []) {
      const newDeg = (inDegree.get(next) || 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  // 环路检测：若拓扑序未覆盖全部节点，说明 depends_on 存在环。
  // schema 层（domain-schema.ts）已有 DFS 兜底，此处是纵深防御，避免绕过校验直接调用时静默生成不完整路由表。
  if (topologicalOrder.length !== tasks.length) {
    const cyclic = tasks.filter((t) => !topologicalOrder.includes(t.id)).map((t) => t.id);
    throw new Error(
      `检测到循环依赖：tasks 中的 depends_on 存在环路（涉及节点：${cyclic.join(", ")}）`,
    );
  }

  const entryPoints = tasks.filter((t) => !t.depends_on || t.depends_on.length === 0).map((t) => t.id);

  const nodes: Record<string, { title: string; depends_on: string[]; accept_criteria: string[] }> = {};
  for (const t of tasks) {
    nodes[t.id] = {
      title: t.title,
      depends_on: t.depends_on ?? [],
      accept_criteria: t.accept_criteria ?? [],
    };
  }

  return JSON.stringify({ nodes, entry_points: entryPoints, topological_order: topologicalOrder }, null, 2);
}

// ── 生成编排 ──

/** generatePlatform 的可选配置。全部字段可选，缺省值与历史行为一致。 */
export interface GenerateOptions {
  /** 演练模式：只打印将写入的文件，不落盘（默认 false）。 */
  dryRun?: boolean;
  /** 用户模板根目录（相对 cwd，默认 .opencode/templates）。 */
  templatesRoot?: string;
  /** 领域 id；缺省回退 ralph 内核范式。 */
  domain?: string;
  /** 额外自定义领域文件路径（JSON）。 */
  domainFiles?: string[];
  /** 增量生成：仅重写内容变化的文件（默认 false）。 */
  incremental?: boolean;
  /** 工作目录（默认 process.cwd()）。 */
  cwd?: string;
  /** 按角色覆盖子 agent 模型（orchestrator/executor/reviewer → model）。 */
  modelOverrides?: Record<string, string>;
}

export function generatePlatform(
  platformKey: string,
  options: GenerateOptions = {},
): { agents: number; commands: number; written?: number } {
  const {
    dryRun = false,
    templatesRoot = DEFAULT_TEMPLATES_ROOT,
    domain,
    domainFiles = [],
    incremental = false,
    cwd = process.cwd(),
    modelOverrides,
  } = options;
  const platform: Platform = PLATFORMS[platformKey];
  if (!platform) throw new Error(`未知平台: ${platformKey}`);

  const renderer = RENDERERS[platform.family];
  const base = join(cwd, platform.dir);
  const agentsDir = join(base, "agents");
  const commandsDir = join(base, "commands");

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
    const backpressureText =
      role === "orchestrator" ? renderBackpressure(resolvedDomain.backpressure) : "";
    const agentVars: Record<string, string> = {
      name: key,
      description,
      backpressure: backpressureText,
      engine_type: resolvedDomain.engine.type,
    };
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
    const tpl = pickCommandTemplate(commandTemplates, resolvedDomain.id, engineType);
    if (!tpl) {
      throw new Error(
        `未找到命令模板: engine.type=${engineType} (domain=${resolvedDomain.id})。预期文件 src/templates/commands/${resolvedDomain.id}-${engineType}.md 或 ${engineType}.md`,
      );
    }
    const cmdVars: Record<string, string> = { name: key, description, agent };
    cmdVars.domain = resolvedDomain.id;
    if (engineType === "graph" && resolvedDomain.tasks) {
      cmdVars.routing_table = buildRoutingTable(resolvedDomain.tasks);
    }
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

  // dry-run 已提前返回，只有真正写盘时才创建输出目录
  try {
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(commandsDir, { recursive: true });
  } catch (err) {
    throw new Error(`无法创建输出目录 (${platform.dir}): ${(err as Error).message}`, {
      cause: err,
    });
  }

  // ── 增量模式 ──
  if (incremental) {
    const manifest = loadManifest(platformKey, cwd);
    const changes = detectChanges(base, expectedFiles, manifest);
    const written = applyChanges(changes, manifest);
    saveManifest(platformKey, manifest, cwd);
    return { agents: agentCount, commands: commandCount, written };
  }

  // ── 全量模式 ──
  // 全量也维护 manifest 并清理孤儿：切换 domain 后，删除工具曾生成、本次不再预期的文件。
  // 只删 manifest 记录过的（工具自己生成的），用户手写文件不受影响——与增量模式同一安全边界。
  const manifest = loadManifest(platformKey, cwd);
  for (const [relativePath, content] of expectedFiles) {
    const path = join(base, relativePath);
    try {
      writeAtomic(path, content);
    } catch (err) {
      throw new Error(`写入失败 ${path}: ${(err as Error).message}`, { cause: err });
    }
    manifest[relativePath] = { hash: computeHash(content) };
  }
  for (const relativePath of Object.keys(manifest)) {
    if (!expectedFiles.has(relativePath)) {
      const path = join(base, relativePath);
      if (existsSync(path)) {
        try {
          unlinkSync(path);
        } catch (err) {
          // 删除失败要可见，但不能静默；不抛——避免一个文件挂掉整批
          console.error(`[${relativePath}] 删除失败: ${(err as Error).message}`);
        }
      }
      delete manifest[relativePath];
    }
  }
  saveManifest(platformKey, manifest, cwd);

  return { agents: agentCount, commands: commandCount };
}
