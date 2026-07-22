import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, existsSync, appendFileSync, readFileSync } from "node:fs";

import { startWatch } from "../watch.js";
import { copyDir } from "./_helpers.js";

/** 每个测试在独立临时目录下运行，完全避免跨测试污染。 */
describe("startWatch", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), "loop-md-cli-watch-test-"));
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
  it("incremental=true produces manifest cache under .loop-cli/cache/", () => {
    // 把内置模板复制到临时目录，让 generate 能找到
    const srcTemplates = join(originalCwd, "src", "templates");
    copyDir(srcTemplates, join(tmpDir, ".opencode", "templates"));
    const cleanup = startWatch(["claude"], undefined, [], undefined, true);
    try {
      // 增量模式的特征产物：.loop-cli/cache/<platform>.json
      const manifestPath = join(tmpDir, ".loop-cli", "cache", "claude.json");
      assert.ok(existsSync(manifestPath), "incremental watch should produce manifest cache");
    } finally {
      cleanup();
    }
  });

  // ─── watch 深度：模板文件变更必须真正触发重新生成 ───
  // 旧测试只验证返回 cleanup 函数，未覆盖"文件改动 → 防抖 → 重生成"主链路。
  it("regenerates output when a watched template file changes", async () => {
    const srcTemplates = join(originalCwd, "src", "templates");
    copyDir(srcTemplates, join(tmpDir, ".opencode", "templates"));

    const cleanup = startWatch(["claude"]);
    try {
      const tplFile = join(tmpDir, ".opencode", "templates", "agents", "ralph-orchestrator.md");
      const outFile = join(tmpDir, ".claude", "agents", "ralph-orchestrator.md");
      assert.ok(existsSync(outFile), "initial generation should produce output");

      // 改动被监听的模板：追加唯一标记行（落入 body，随渲染进入输出）
      const marker = `WATCH_MARKER_${Date.now()}`;
      appendFileSync(tplFile, `\n${marker}\n`, "utf-8");

      // 等待防抖（300ms）+ fs.watch 延迟后的重新生成，最多 5s
      await waitFor(() => {
        try {
          return readFileSync(outFile, "utf-8").includes(marker);
        } catch {
          return false;
        }
      }, 5000);

      assert.ok(
        readFileSync(outFile, "utf-8").includes(marker),
        "output should reflect the template change",
      );
    } finally {
      cleanup();
    }
  });
});

/** 轮询等待 predicate 为真，超时抛错。用于等待 fs.watch + 防抖异步链路。 */
async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  intervalMs = 100,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
