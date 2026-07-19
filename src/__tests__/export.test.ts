import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
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
});
