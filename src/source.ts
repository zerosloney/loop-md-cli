/**
 * 源文件读取：agents/ + commands/ 是唯一真相源。
 * 每个源含完整 frontmatter（mode/permission/temperature/steps/model 等）+ 正文。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSource, type Frontmatter } from "./frontmatter.js";

export interface AgentSource {
  name: string;
  description: string;
  frontmatter: Frontmatter; // 完整源 frontmatter（permission/mode/temperature/steps/model 等）
  body: string; // 工具无关正文
}

export interface CommandSource {
  name: string;
  description: string;
  frontmatter: Frontmatter;
  body: string;
}

const ROOT = process.cwd();

function readMd(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf-8");
}

/** 加载单个 agent 源。description 从源 frontmatter 提取（若 registry 也给了以 registry 为准）。 */
export function loadAgent(name: string, registryDescription: string): AgentSource {
  const { frontmatter, body } = parseSource(readMd(join("agents", `${name}.md`)));
  return {
    name,
    description: registryDescription,
    frontmatter,
    body,
  };
}

/** 加载单个 command 源。 */
export function loadCommand(name: string, registryDescription: string): CommandSource {
  const { frontmatter, body } = parseSource(readMd(join("commands", `${name}.md`)));
  return {
    name,
    description: registryDescription,
    frontmatter,
    body,
  };
}
