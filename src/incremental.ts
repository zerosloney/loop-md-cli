/**
 * 增量生成引擎：通过内容哈希检测文件变更，仅重写已变化的文件，并清理 manifest 记录过的孤儿。
 *
 * Manifest 存储位置：{cwd}/.loop-forge/{platform}.json
 * 格式：{ "agents/orchestrator.md": { "hash": "sha256..." } }
 *
 * 工作流程：
 *   1. 读取 manifest（不存在则视为首次运行）
 *   2. 渲染预期内容 → 计算 hash
 *   3. 对比 manifest：
 *        - expected 有，hash 不同（或新文件）→ write
 *        - expected 有，hash 相同 → skip
 *        - manifest 有但 expected 没有 → delete（清理切换领域/删除领域时的孤儿）
 *   4. applyChanges 写盘/删盘，并同步更新 manifest
 *
 * 只删 manifest 记录过的孤儿：用户手写、从未被工具生成的文件不会被触碰。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const MANIFEST_DIR = ".loop-forge";

// ── 类型 ──

interface ManifestEntry {
  hash: string;
}

export interface Manifest {
  [relativePath: string]: ManifestEntry;
}

// ── 哈希 ──

/** 计算内容的 SHA-256 hex 摘要 */
export function computeHash(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

// ── Manifest 读写 ──

/** 获取某平台的 manifest 文件路径（绝对路径） */
export function manifestPath(platformKey: string, cwd = process.cwd()): string {
  return join(cwd, MANIFEST_DIR, `${platformKey}.json`);
}

/** 读取 manifest，不存在则返回空对象 */
export function loadManifest(platformKey: string, cwd = process.cwd()): Manifest {
  const path = manifestPath(platformKey, cwd);
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as Manifest;
  } catch {
    // 损坏的 manifest 视为空
    return {};
  }
}

/** 保存 manifest */
export function saveManifest(platformKey: string, manifest: Manifest, cwd = process.cwd()): void {
  const path = manifestPath(platformKey, cwd);
  const dir = join(path, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(manifest, null, 2), "utf-8");
}

// ── 变更检测 ──

/** 文件动作 */
export type WriteAction = "write" | "skip" | "delete";

export interface FileChange {
  /** 相对于 baseDir 的路径，如 agents/orchestrator.md */
  relativePath: string;
  /** 绝对路径 */
  fullPath: string;
  /** 动作 */
  action: WriteAction;
  /** 预期内容（action=write 时有值；delete/skip 时为 undefined） */
  content?: string;
}

/**
 * 对比预期内容与 manifest，返回变更列表（含 delete）。
 * @param baseDir 输出基础目录
 * @param expectedFiles Map<相对路径, 内容>
 * @param manifest 上次生成的 manifest
 */
export function detectChanges(
  baseDir: string,
  expectedFiles: Map<string, string>,
  manifest: Manifest,
): FileChange[] {
  const changes: FileChange[] = [];

  // 1. expected 中的文件：write 或 skip
  for (const [relativePath, content] of expectedFiles) {
    const hash = computeHash(content);
    const prev = manifest[relativePath];
    const fullPath = join(baseDir, relativePath);
    const action: WriteAction = (!prev || prev.hash !== hash) ? "write" : "skip";
    changes.push({ relativePath, fullPath, action, content });
  }

  // 2. manifest 有但 expected 没有的文件：delete（清理孤儿）
  //    只清理 manifest 记录过的文件（即工具自己生成过的），用户手写文件不受影响。
  for (const relativePath of Object.keys(manifest)) {
    if (!expectedFiles.has(relativePath)) {
      const fullPath = join(baseDir, relativePath);
      changes.push({ relativePath, fullPath, action: "delete" });
    }
  }

  return changes;
}

/**
 * 应用变更：write 写盘 + 更新 hash；skip 跳过；delete 删盘 + 移除 manifest 条目。
 * @param changes 变更列表
 * @param manifest manifest 对象（会被就地更新）
 * @returns 写入的文件数（不含删除）
 */
export function applyChanges(changes: FileChange[], manifest: Manifest): number {
  let written = 0;

  for (const change of changes) {
    if (change.action === "write" && change.content !== undefined) {
      try {
        const dir = join(change.fullPath, "..");
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(change.fullPath, change.content, "utf-8");
        written++;
      } catch (err) {
        // 写入失败要可见，不能静默
        console.error(`[${change.relativePath}] 写入失败: ${(err as Error).message}`);
      }
    } else if (change.action === "delete") {
      if (existsSync(change.fullPath)) {
        try {
          unlinkSync(change.fullPath);
        } catch (err) {
          // 删除失败要可见，不能静默（但不抛——避免一个文件挂掉整批）
          console.error(`[${change.relativePath}] 删除失败: ${(err as Error).message}`);
        }
      }
    }
  }

  // 同步 manifest：write 写入新 hash；delete 移除条目；skip 不动
  for (const change of changes) {
    if (change.action === "write" && change.content !== undefined) {
      manifest[change.relativePath] = { hash: computeHash(change.content) };
    } else if (change.action === "delete") {
      delete manifest[change.relativePath];
    }
  }

  return written;
}
