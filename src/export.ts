/**
 * 导出功能：将所有平台配置打包为 ZIP 文件。
 *
 * 零依赖实现：使用 Node.js 内置 fs 构建合法 ZIP 归档（无压缩模式）。
 * ZIP 格式简单且跨平台（Windows/macOS/Linux 均原生支持）。
 *
 * 用法:
 *   loop-forge --all --archive configs.zip
 *   loop-forge --claude --opencode --archive
 */
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { PLATFORMS, PLATFORM_KEYS } from "./platforms.js";
import { generatePlatform } from "./generate.js";

// ── 导出结果 ──

export interface ExportResult {
  filePath: string;
  fileCount: number;
  platformCount: number;
}

// ── 核心导出逻辑 ──

function collectFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const st = statSync(fullPath);
    if (st.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (entry.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

export function exportArchive(
  platforms: string[],
  output: string,
  domain?: string,
  domainFiles: string[] = [],
  cwd = process.cwd(),
): ExportResult {
  if (!output.endsWith(".zip")) output += ".zip";

  // 先生成
  for (const key of platforms) {
    generatePlatform(key, false, ".opencode/templates", domain, domainFiles, false, cwd);
  }

  // 收集文件
  interface ZipEntry { name: string; data: Buffer; }
  const entries: ZipEntry[] = [];

  for (const key of platforms) {
    const platform = PLATFORMS[key];
    if (!platform) continue;
    const baseDir = join(cwd, platform.dir);
    if (!existsSync(baseDir)) continue;
    for (const subDir of ["agents", "commands"]) {
      const dirPath = join(baseDir, subDir);
      if (!existsSync(dirPath)) continue;
      for (const file of collectFiles(dirPath)) {
        const fileName = file.split(/[/\\]/).pop()!;
        entries.push({ name: `${platform.dir}/${subDir}/${fileName}`, data: readFileSync(file) });
      }
    }
  }

  const zipBuffer = buildZip(entries);

  const outDir = join(output, "..");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(output, zipBuffer);

  return {
    filePath: output,
    fileCount: entries.length,
    platformCount: platforms.filter((k) => PLATFORMS[k]).length,
  };
}

// ── ZIP 构建 ──

const LOCAL_SIG = 0x04034b50;
const CD_SIG = 0x02014b50;
const EOCDR_SIG = 0x06054b50;

function u16(b: Buffer, o: number, v: number) { b.writeUInt16LE(v, o); }
function u32(b: Buffer, o: number, v: number) { b.writeUInt32LE(v, o); }
function wstr(b: Buffer, o: number, s: string): number {
  const bytes = Buffer.from(s, "utf-8");
  bytes.copy(b, o);
  return bytes.length;
}

interface FileInfo {
  name: string;
  size: number;
  offset: number;
}

function buildZip(entries: { name: string; data: Buffer }[]): Buffer {
  // Phase 1: compute local file entry sizes and offsets
  const infos: FileInfo[] = [];
  let localDataSize = 0;
  for (const e of entries) {
    const entrySize = 28 + e.name.length + e.data.length;
    infos.push({ name: e.name, size: e.data.length, offset: localDataSize });
    localDataSize += entrySize;
  }

  // Phase 2: compute central directory size
  let cdSize = 0;
  for (const info of infos) {
    cdSize += 44 + info.name.length;
  }
  const eocdrSize = 22;

  // Total buffer size
  const totalSize = localDataSize + cdSize + eocdrSize;
  const buf = Buffer.alloc(totalSize);
  let pos = 0;

  // Phase 3: write local file headers + data
  for (let i = 0; i < infos.length; i++) {
    const info = infos[i];
    const e = entries[i];
    u32(buf, pos, LOCAL_SIG); pos += 4;
    u16(buf, pos, 20); pos += 2;
    u16(buf, pos, 0); pos += 2;
    u16(buf, pos, 0); pos += 2;
    u16(buf, pos, 0); pos += 2;
    u16(buf, pos, 0); pos += 2;
    u32(buf, pos, 0); pos += 4;
    u32(buf, pos, info.size); pos += 4;
    u32(buf, pos, info.size); pos += 4;
    pos += wstr(buf, pos, info.name);
    u16(buf, pos, 0); pos += 2;
    e.data.copy(buf, pos);
    pos += info.size;
  }

  // Phase 4: write central directory
  const cdStart = pos;
  for (let i = 0; i < infos.length; i++) {
    const info = infos[i];
    u32(buf, pos, CD_SIG); pos += 4;
    u16(buf, pos, 20); pos += 2;
    u16(buf, pos, 20); pos += 2;
    u16(buf, pos, 0); pos += 2;
    u16(buf, pos, 0); pos += 2;
    u16(buf, pos, 0); pos += 2;
    u16(buf, pos, 0); pos += 2;
    u32(buf, pos, 0); pos += 4;
    u32(buf, pos, info.size); pos += 4;
    u32(buf, pos, info.size); pos += 4;
    pos += wstr(buf, pos, info.name);
    u16(buf, pos, 0); pos += 2;
    u16(buf, pos, 0); pos += 2;
    u16(buf, pos, 0); pos += 2;
    u16(buf, pos, 0); pos += 2;
    u32(buf, pos, 0); pos += 4;
    u32(buf, pos, info.offset); pos += 4;
  }

  // Phase 5: write end of central directory record
  const actualCdSize = pos - cdStart;
  u32(buf, pos, EOCDR_SIG); pos += 4;
  u16(buf, pos, 0); pos += 2;
  u16(buf, pos, 0); pos += 2;
  u16(buf, pos, infos.length); pos += 2;
  u16(buf, pos, infos.length); pos += 2;
  u32(buf, pos, actualCdSize); pos += 4;
  u32(buf, pos, cdStart); pos += 4;
  u16(buf, pos, 0); pos += 2;

  return buf;
}
