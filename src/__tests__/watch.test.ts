import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, existsSync } from "node:fs";

import { startWatch } from "../watch.js";
import { copyDir } from "./_helpers.js";

/** 每个测试在独立临时目录下运行，完全避免跨测试污染。 */
describe("startWatch", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), "loop-forge-watch-test-"));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it("returns a cleanup function", () => {
    const cleanup = startWatch(["claude"]);
    assert.equal(typeof cleanup, "function");
    cleanup();
  });

  it("handles empty platform list", () => {
    const cleanup = startWatch([]);
    cleanup();
  });

  it("cleanup function is callable multiple times", () => {
    const cleanup = startWatch(["opencode"]);
    cleanup();
    cleanup(); // idempotent
  });

  // ─── 缺陷 D 回归：--watch --incremental 应该真正走增量生成 ───
  // 旧实现 startWatch 签名没 incremental 参数，--watch --incremental 的 -i 被默默忽略，
  // 每次文件改动全量重写所有文件。修复后增量模式会生成 manifest 缓存作为特征产物。
  it("incremental=true produces manifest cache under .loop-forge/cache/", () => {
    // 把内置模板复制到临时目录，让 generate 能找到
    const srcTemplates = join(originalCwd, "src", "templates");
    copyDir(srcTemplates, join(tmpDir, ".opencode", "templates"));

    const cleanup = startWatch(["claude"], undefined, [], tmpDir, true);
    try {
      // 增量模式的特征产物：.loop-forge/cache/<platform>.json
      const manifestPath = join(tmpDir, ".loop-forge", "cache", "claude.json");
      assert.ok(existsSync(manifestPath), "incremental watch should produce manifest cache");
    } finally {
      cleanup();
    }
  });
});
