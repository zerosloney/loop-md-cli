/**
 * 生成编排：读源 → 按 family 分派 renderer → 写盘到 <dir>/agents、<dir>/commands。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PLATFORMS, type Family, type Platform } from "./platforms.js";
import { AGENTS, COMMANDS } from "./registry.js";
import { loadAgent, loadCommand } from "./source.js";
import type { Renderer } from "./render/types.js";
import { NamedRenderer } from "./render/named.js";
import { ModeRenderer } from "./render/mode.js";
import { CodeBuddyRenderer } from "./render/codebuddy.js";
import { TraeRenderer } from "./render/trae.js";

const ROOT = process.cwd();

const RENDERERS: Record<Family, Renderer> = {
  named: new NamedRenderer(),
  mode: new ModeRenderer(),
  codebuddy: new CodeBuddyRenderer(),
  trae: new TraeRenderer(),
};

export function generatePlatform(platformKey: string): { agents: number; commands: number } {
  const platform: Platform = PLATFORMS[platformKey];
  if (!platform) throw new Error(`未知平台: ${platformKey}`);

  const renderer = RENDERERS[platform.family];
  const base = join(ROOT, platform.dir);
  const agentsDir = join(base, "agents");
  const commandsDir = join(base, "commands");
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(commandsDir, { recursive: true });

  let agentCount = 0;
  for (const [name, meta] of Object.entries(AGENTS)) {
    const src = loadAgent(name, meta.description);
    const out = renderer.renderAgent(src, platform);
    writeFileSync(join(agentsDir, `${name}.md`), out, "utf-8");
    agentCount++;
  }

  let commandCount = 0;
  for (const [name, meta] of Object.entries(COMMANDS)) {
    const src = loadCommand(name, meta.description);
    const out = renderer.renderCommand(src, platform);
    writeFileSync(join(commandsDir, `${name}.md`), out, "utf-8");
    commandCount++;
  }

  return { agents: agentCount, commands: commandCount };
}
