/**
 * 生成编排：domain 模式用模板+领域映射渲染；无 domain 用模板+角色名直出。
 */
import { mkdirSync, writeFileSync } from "node:fs";
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

const ROOT = process.cwd();
const DEFAULT_TEMPLATES_ROOT = ".opencode/templates";

const RENDERERS: Record<Family, Renderer> = {
  named: new NamedRenderer(),
  mode: new ModeRenderer(),
  codebuddy: new CodeBuddyRenderer(),
  trae: new TraeRenderer(),
};

export function generatePlatform(
  platformKey: string,
  dryRun = false,
  templatesRoot = DEFAULT_TEMPLATES_ROOT,
  domain?: string,
  domainFiles: string[] = [],
): { agents: number; commands: number } {
  const platform: Platform = PLATFORMS[platformKey];
  if (!platform) throw new Error(`未知平台: ${platformKey}`);

  const renderer = RENDERERS[platform.family];
  const base = join(ROOT, platform.dir);
  const agentsDir = join(base, "agents");
  const commandsDir = join(base, "commands");
  try {
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(commandsDir, { recursive: true });
  } catch (err) {
    throw new Error(`无法创建输出目录 (${platform.dir}): ${(err as Error).message}`);
  }

  const templatesBase = join(ROOT, templatesRoot);
  const userAgentTemplates = loadTemplateFiles(join(templatesBase, "agents"));
  const userCommandTemplates = loadTemplateFiles(join(templatesBase, "commands"));
  const pkgAgentTemplates = loadAgentTemplates();
  const pkgCommandTemplates = loadCommandTemplates();
  const agentTemplates = { ...pkgAgentTemplates, ...userAgentTemplates };
  const commandTemplates = { ...pkgCommandTemplates, ...userCommandTemplates };

  const resolvedDomains = resolveDomains(domainFiles);
  const resolvedDomain = domain ? findDomain(resolvedDomains, domain) : undefined;

  let agentCount = 0;
  const agentEntries = resolvedDomain
    ? resolvedDomain.agents.map((a) => ({ role: a.role, key: a.name, description: a.description }))
    : AGENT_ROLES.map((role) => ({
        role,
        key: AGENTS[role].description ? role : role,
        description: AGENTS[role].description,
      }));

  for (const { role, key, description } of agentEntries) {
    const tpl = agentTemplates[role];
    if (!tpl) continue;
    const rendered = renderTemplate(tpl, { name: key, description });
    const { frontmatter, body } = parseSource(rendered);
    const src: AgentSource = { name: key, description, frontmatter, body };
    const out = renderer.renderAgent(src, platform);
    const path = join(agentsDir, `${key}.md`);
    if (dryRun) {
      console.log(`[dry-run] 将写入 ${path}`);
    } else {
      try {
        writeFileSync(path, out, "utf-8");
      } catch (err) {
        throw new Error(`写入失败 ${path}: ${(err as Error).message}`);
      }
    }
    agentCount++;
  }

  let commandCount = 0;
  const commandEntries = resolvedDomain
    ? resolvedDomain.commands.map((c) => ({ role: c.role, key: c.name, description: c.description }))
    : COMMAND_ROLES.map((role) => ({
        role,
        key: role,
        description: COMMANDS[role].description,
      }));

  for (const { role, key, description } of commandEntries) {
    const tpl = commandTemplates[role];
    if (!tpl) continue;
    const commandAgent = key.endsWith("-loop") ? `${key.slice(0, -5)}-orchestrator` : `${key}-orchestrator`;
    const rendered = renderTemplate(tpl, { name: key, description, agent: commandAgent });
    const { frontmatter, body } = parseSource(rendered);
    const src: CommandSource = { name: key, description, frontmatter, body };
    const out = renderer.renderCommand(src, platform);
    const path = join(commandsDir, `${key}.md`);
    if (dryRun) {
      console.log(`[dry-run] 将写入 ${path}`);
    } else {
      try {
        writeFileSync(path, out, "utf-8");
      } catch (err) {
        throw new Error(`写入失败 ${path}: ${(err as Error).message}`);
      }
    }
    commandCount++;
  }

  return { agents: agentCount, commands: commandCount };
}