import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";

import { exportArchive } from "../export.js";
import { copyDir } from "./_helpers.js";

/** 把 src/templates/ 递归复制到目标目录。 */
function copyTemplatesTo(dest: string): void {
  const src = join(process.cwd(), "src", "templates");
  copyDir(src, dest);
}

// ─── 最小 ZIP 结构解析器 ───
// 用于回归测试：独立验证 exportArchive 输出的 ZIP 在结构层面合规（不依赖外部 unzip）。
// 验证 local header / central directory / EOCDR 全部字段、CRC-32 自洽、UTF-8 flag 设置。

interface ZipEntry {
  name: string;
  data: Buffer;
  crc: number;
  utf8Flag: boolean;
  method: number;
}

function parseZip(buf: Buffer): ZipEntry[] {
  // EOCDR 在文件末尾，最小 22 字节
  assert.ok(buf.length >= 22, "ZIP too short");
  const eocdr = buf.length - 22;
  assert.equal(buf.readUInt32LE(eocdr), 0x06054b50, "EOCDR signature");
  const totalEntries = buf.readUInt16LE(eocdr + 10);
  const cdSize = buf.readUInt32LE(eocdr + 12);
  const cdOffset = buf.readUInt32LE(eocdr + 16);

  const entries: ZipEntry[] = [];
  let pos = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    assert.equal(buf.readUInt32LE(pos), 0x02014b50, "CD entry signature");
    const gpFlag = buf.readUInt16LE(pos + 8);
    const method = buf.readUInt16LE(pos + 10);
    const crc = buf.readUInt32LE(pos + 16) >>> 0;
    const compSize = buf.readUInt32LE(pos + 20);
    const uncompSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString("utf-8");

    // 跳到 local header 拿数据
    assert.equal(buf.readUInt32LE(localHeaderOffset), 0x04034b50, "local header signature");
    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const data = buf.subarray(dataStart, dataStart + uncompSize);

    entries.push({
      name,
      data,
      crc,
      utf8Flag: (gpFlag & 0x0800) !== 0,
      method,
    });

    // integrity checks
    assert.equal(compSize, uncompSize, `${name}: stored method → comp=uncomp`);
    assert.equal(method, 0, `${name}: method must be stored(0)`);
    assert.equal(localNameLen, nameLen, `${name}: local/CD name length mismatch`);

    pos += 46 + nameLen + extraLen + commentLen;
  }
  assert.equal(pos - cdOffset, cdSize, "CD size field matches actual");
  return entries;
}

// 独立 CRC-32 实现（不依赖 export.ts 的内部函数），用于和 ZIP 写入的 CRC 对比
const CRC_TABLE_TEST = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32Test(buf: Buffer): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE_TEST[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** 每个测试在独立临时目录下运行，完全避免跨测试污染。 */
describe("exportArchive", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "loop-forge-export-test-"));
    // 把模板复制到临时目录，generatePlatform 在任意 cwd 下都能找到
    copyTemplatesTo(join(tmpDir, ".opencode", "templates"));
  });

  it("auto-appends .zip extension", () => {
    const outputPath = join(tmpDir, "test-auto-ext.zip");
    const result = exportArchive(["claude"], outputPath, undefined, [], tmpDir);
    assert.ok(result.filePath.endsWith(".zip"), "should auto-append .zip");
    assert.ok(existsSync(result.filePath), "zip file should exist");
  });

  it("produces valid ZIP local file header signature", () => {
    const outputPath = join(tmpDir, "test-sig.zip");
    const result = exportArchive(["claude"], outputPath, undefined, [], tmpDir);
    const data = readFileSync(result.filePath);
    assert.equal(data.readUInt32LE(0), 0x04034b50, "should start with local file header sig");
  });

  it("produces valid ZIP EOCDR at end", () => {
    const outputPath = join(tmpDir, "test-eocdr.zip");
    const result = exportArchive(["claude"], outputPath, undefined, [], tmpDir);
    const data = readFileSync(result.filePath);
    const eoctr = data.length - 22;
    assert.equal(data.readUInt32LE(eoctr), 0x06054b50, "should end with EOCDR sig");
  });

  it("exports multiple platforms", () => {
    const outputPath = join(tmpDir, "test-multi.zip");
    const result = exportArchive(["claude", "opencode"], outputPath, undefined, [], tmpDir);
    assert.equal(result.platformCount, 2);
    assert.ok(result.fileCount > 0, "should have files");
    assert.ok(statSync(result.filePath).size > 0, "ZIP should not be empty");
  });

  // ─── 缺陷 2 回归：ZIP 结构合规 + 非 ASCII 文件名 ───
  // 旧实现：① 缺 name length / extra length 字段，CRC=0，未设 UTF-8 flag → 结构非法
  //         ② buffer size 用字符数算但用 UTF-8 字节写 → 中文文件名越界崩溃

  it("produces structurally valid ZIP with correct CRC and UTF-8 flag", () => {
    const outputPath = join(tmpDir, "test-valid.zip");
    const result = exportArchive(["claude"], outputPath, undefined, [], tmpDir);
    const buf = readFileSync(result.filePath);
    const entries = parseZip(buf);

    assert.ok(entries.length > 0, "should have entries");
    assert.equal(entries.length, result.fileCount, "entry count matches reported fileCount");

    for (const e of entries) {
      assert.equal(e.utf8Flag, true, `${e.name}: UTF-8 flag must be set`);
      assert.equal(e.method, 0, `${e.name}: must be stored`);
      const recomputed = crc32Test(e.data);
      assert.equal(recomputed, e.crc, `${e.name}: CRC-32 mismatch (expected ${e.crc.toString(16)}, got ${recomputed.toString(16)})`);
      assert.ok(e.data.length > 0, `${e.name}: data should be non-empty`);
    }
  });

  it("handles non-ASCII (Chinese) filenames without crashing and preserves UTF-8", () => {
    // 故意在生成结果目录里放一个中文文件名的 agent，让 collectFiles 收进 ZIP
    const claudeAgentsDir = join(tmpDir, ".claude", "agents");
    mkdirSync(claudeAgentsDir, { recursive: true });
    writeFileSync(join(claudeAgentsDir, "测试-reviewer.md"), "# 测试 agent\n", "utf-8");
    writeFileSync(join(claudeAgentsDir, "ralph-orchestrator.md"), "# ralph\n", "utf-8");

    const outputPath = join(tmpDir, "test-unicode.zip");
    // exportArchive 会先生成再打包，但我们手动放的文件在生成过程中可能被覆盖；
    // 这里用生成后再放文件、再调一次 export 的策略不行（export 内部会生成覆盖）。
    // 改用：直接调用 export（会生成默认 agents），然后单独写文件后用同一个 cli 重新 archive。
    // 简化：直接验证 exportArchive 在已有中文文件场景不崩溃。
    const result = exportArchive(["claude"], outputPath, undefined, [], tmpDir);

    const buf = readFileSync(result.filePath);
    const entries = parseZip(buf);

    // 至少应包含我们手动放的两个文件名（前提：未被 export 内部 generatePlatform 覆盖删除）
    // 由于 export 内部 generatePlatform 是全量写，手动放的文件会与生成的共存（不清理）
    const names = entries.map((e) => e.name);
    assert.ok(
      names.some((n) => n.includes("测试-reviewer")),
      `中文文件名应保留在 ZIP 中（旧实现会崩溃）。实际条目: ${names.join(", ")}`,
    );

    // 验证中文条目的 CRC 自洽
    const cnEntry = entries.find((e) => e.name.includes("测试-reviewer"))!;
    assert.equal(crc32Test(cnEntry.data), cnEntry.crc, "中文条目 CRC-32 应自洽");
  });

  it("entry count matches across platforms (multi-platform integrity)", () => {
    const outputPath = join(tmpDir, "test-multi-valid.zip");
    const result = exportArchive(["claude", "opencode", "trae"], outputPath, undefined, [], tmpDir);
    const buf = readFileSync(result.filePath);
    const entries = parseZip(buf);
    assert.equal(entries.length, result.fileCount, "parsed entry count must match reported");
    assert.equal(result.platformCount, 3);
    // 每个平台的条目名都应以对应目录前缀开头
    const prefixes = [".claude/", ".opencode/", ".trae/"];
    for (const pfx of prefixes) {
      assert.ok(entries.some((e) => e.name.startsWith(pfx)), `should have entries under ${pfx}`);
    }
  });
});
