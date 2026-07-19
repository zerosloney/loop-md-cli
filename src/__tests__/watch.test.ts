import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";

import { startWatch } from "../watch.js";

/** 每个测试在独立临时目录下运行，完全避免跨测试污染。 */
describe("startWatch", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "loop-forge-watch-test-"));
    process.chdir(tmpDir);
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
});
