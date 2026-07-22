/**
 * 导出功能：将所有平台配置打包为 ZIP 文件。
 *
 * 零依赖实现：使用 Node.js 内置 fs 构建合法 ZIP 归档（无压缩模式）。
 * ZIP 格式简单且跨平台（Windows/macOS/Linux 均原生支持）。
 *
 * 重要：生成过程在临时目录中进行，**不污染用户工程目录**——用户跑 --archive
 * 期望只产出一个 ZIP 文件，不应该在 cwd 留下 .claude/ .opencode/ 等目录。
 *
 * 用法:
 *   loop-md-cli --all --archive configs.zip
 *   loop-md-cli --claude --opencode --archive
 */
import {
  existsSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { PLATFORMS } from "./platforms.js";
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

/** 递归复制 srcDir 到 destDir（用于把用户模板带进临时目录）。 */
function copyDir(srcDir: string, destDir: string): void {
  if (!existsSync(srcDir)) return;
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    const s = join(srcDir, entry);
    const d = join(destDir, entry);
    if (statSync(s).isDirectory()) {
      copyDir(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}

export function exportArchive(
  platforms: string[],
  output: string,
  domain?: string,
  domainFiles: string[] = [],
  cwd = process.cwd(),
): ExportResult {
  if (!output.endsWith(".zip")) output += ".zip";

  // 在临时目录里生成，避免污染用户工程目录。把用户的 .opencode/templates/ 和
  // .opencode/domains/ 一并带进去，让生成能用到团队共享模板/领域。
  const tmpBase = mkdtempSync(join(tmpdir(), "loop-md-cli-archive-"));
  try {
    copyDir(join(cwd, ".opencode", "templates"), join(tmpBase, ".opencode", "templates"));
    copyDir(join(cwd, ".opencode", "domains"), join(tmpBase, ".opencode", "domains"));

    for (const key of platforms) {
      generatePlatform(key, { domain, domainFiles, cwd: tmpBase });
    }

    // 收集文件
    interface ZipEntry {
      name: string;
      data: Buffer;
    }
    const entries: ZipEntry[] = [];

    for (const key of platforms) {
      const platform = PLATFORMS[key];
      if (!platform) continue;
      const baseDir = join(tmpBase, platform.dir);
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

    // output 保持原值不变（相对路径相对 process.cwd() 解析，与 generate.ts 行为一致）。
    // 用 resolve 把 output 父目录算出来确保存在；output 本身原样返回给调用方。
    const outDir = join(output, "..");
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    writeFileSync(output, zipBuffer);

    return {
      filePath: output,
      fileCount: entries.length,
      platformCount: platforms.filter((k) => PLATFORMS[k]).length,
    };
  } finally {
    rmSync(tmpBase, { recursive: true, force: true });
  }
}

// ── ZIP 构建 ──
//
// 按 PKZIP APPNOTE 6.3.x 实现 STORED（method=0）归档，关键字段：
//   general purpose bit flag bit 11 (0x0800) → 文件名按 UTF-8 编码（多字节文件名必需）
//   file name length / extra field length    → local header offset 26/28、CD offset 28/30 必填
//   crc-32                                    → 对未压缩数据计算（标准 PKZIP/polynomial 0xEDB88320）
//
// 旧实现的 bug：① 用 e.name.length（字符数）算 buffer size 但用 UTF-8 字节写入 → 非 ASCII 文件名越界崩溃
//               ② 完全缺 name length / extra length 字段，CRC=0，未设 UTF-8 flag → 结构非法

const LOCAL_SIG = 0x04034b50;
const CD_SIG = 0x02014b50;
const EOCDR_SIG = 0x06054b50;
const GP_UTF8 = 0x0800; // bit 11: 文件名是 UTF-8

function u16(b: Buffer, o: number, v: number) {
  b.writeUInt16LE(v, o);
}
function u32(b: Buffer, o: number, v: number) {
  b.writeUInt32LE(v, o);
}
function wstr(b: Buffer, o: number, s: string): number {
  const bytes = Buffer.from(s, "utf-8");
  bytes.copy(b, o);
  return bytes.length;
}

// 标准 PKZIP CRC-32 (polynomial 0xEDB88320, reflected)
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface FileInfo {
  name: string;
  nameBytes: number; // UTF-8 字节数（不是字符数）
  size: number;
  crc: number;
  offset: number;
}

// MS-DOS 时间/日期格式（ZIP 标准字段）。
// 把 Date 转为 16 位 time / 16 位 date；避免解压后文件时间显示 1980-00-00。
function dosDateTime(d: Date): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date =
    (((d.getFullYear() - 1980) & 0x7f) << 9) |
    (((d.getMonth() + 1) & 0xf) << 5) |
    (d.getDate() & 0x1f);
  return { time, date };
}

function buildZip(entries: { name: string; data: Buffer }[]): Buffer {
  // 所有条目共享打包时刻，简化逻辑且对工具行为无影响。
  const { time: modTime, date: modDate } = dosDateTime(new Date());
  // Phase 1: 计算每个 local entry 的 size 和 offset
  // Local file header = 30 字节固定 + nameBytes + data
  const infos: FileInfo[] = [];
  let localDataSize = 0;
  for (const e of entries) {
    const nameBytes = Buffer.byteLength(e.name, "utf-8");
    const crc = crc32(e.data);
    const entrySize = 30 + nameBytes + e.data.length;
    infos.push({ name: e.name, nameBytes, size: e.data.length, crc, offset: localDataSize });
    localDataSize += entrySize;
  }

  // Phase 2: central directory 大小
  // CD entry = 46 字节固定 + nameBytes
  let cdSize = 0;
  for (const info of infos) {
    cdSize += 46 + info.nameBytes;
  }
  const eocdrSize = 22;

  const totalSize = localDataSize + cdSize + eocdrSize;
  const buf = Buffer.alloc(totalSize);
  let pos = 0;

  // Phase 3: 写 local file header + name + data
  for (let i = 0; i < infos.length; i++) {
    const info = infos[i];
    const e = entries[i];
    u32(buf, pos, LOCAL_SIG);
    pos += 4; // signature
    u16(buf, pos, 20);
    pos += 2; // version needed to extract (2.0)
    u16(buf, pos, GP_UTF8);
    pos += 2; // general purpose bit flag: UTF-8
    u16(buf, pos, 0);
    pos += 2; // compression method: stored
    u16(buf, pos, modTime);
    pos += 2; // mod time
    u16(buf, pos, modDate);
    pos += 2; // mod date
    u32(buf, pos, info.crc);
    pos += 4; // CRC-32
    u32(buf, pos, info.size);
    pos += 4; // compressed size
    u32(buf, pos, info.size);
    pos += 4; // uncompressed size
    u16(buf, pos, info.nameBytes);
    pos += 2; // file name length
    u16(buf, pos, 0);
    pos += 2; // extra field length
    pos += wstr(buf, pos, info.name); // file name (UTF-8 bytes)
    e.data.copy(buf, pos);
    pos += info.size;
  }

  // Phase 4: 写 central directory
  const cdStart = pos;
  for (const info of infos) {
    u32(buf, pos, CD_SIG);
    pos += 4; // signature
    u16(buf, pos, 20);
    pos += 2; // version made by
    u16(buf, pos, 20);
    pos += 2; // version needed
    u16(buf, pos, GP_UTF8);
    pos += 2; // general purpose bit flag: UTF-8
    u16(buf, pos, 0);
    pos += 2; // compression method: stored
    u16(buf, pos, modTime);
    pos += 2; // mod time
    u16(buf, pos, modDate);
    pos += 2; // mod date
    u32(buf, pos, info.crc);
    pos += 4; // CRC-32
    u32(buf, pos, info.size);
    pos += 4; // compressed size
    u32(buf, pos, info.size);
    pos += 4; // uncompressed size
    u16(buf, pos, info.nameBytes);
    pos += 2; // file name length
    u16(buf, pos, 0);
    pos += 2; // extra field length
    u16(buf, pos, 0);
    pos += 2; // file comment length
    u16(buf, pos, 0);
    pos += 2; // disk number start
    u16(buf, pos, 0);
    pos += 2; // internal attributes
    u32(buf, pos, 0);
    pos += 4; // external attributes
    u32(buf, pos, info.offset);
    pos += 4; // local header offset
    pos += wstr(buf, pos, info.name);
  }

  // Phase 5: 写 EOCDR
  const actualCdSize = pos - cdStart;
  u32(buf, pos, EOCDR_SIG);
  pos += 4;
  u16(buf, pos, 0);
  pos += 2; // disk number
  u16(buf, pos, 0);
  pos += 2; // disk with CD start
  u16(buf, pos, infos.length);
  pos += 2; // entries on this disk
  u16(buf, pos, infos.length);
  pos += 2; // total entries
  u32(buf, pos, actualCdSize);
  pos += 4; // CD size
  u32(buf, pos, cdStart);
  pos += 4; // CD offset
  u16(buf, pos, 0); // comment length

  return buf;
}
