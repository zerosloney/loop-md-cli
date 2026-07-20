import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { validatePlatform, formatValidateResult } from "../validate.js";
import { generatePlatform } from "../generate.js";

// ─── Core validation logic tests ───

describe("validatePlatform", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), "loop-md-cli-validate-test-"));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it("reports all files as missing when platform dir does not exist", () => {
    // 无 domain 时默认回退 ralph → 4 个预期文件（3 agents + 1 command）
    const result = validatePlatform("claude");
    assert.ok(!result.clean, "non-existent dir should report missing files");
    assert.ok(result.issueCount > 0);

    const missingIssues = result.issues.filter((i) => i.type === "missing");
    assert.equal(missingIssues.length, 4, "should report all 4 files as missing");
  });

  it("throws on unknown platform", () => {
    assert.throws(() => validatePlatform("nonexistent"), /未知平台/);
  });

  it("detects stale when domain was changed", () => {
    generatePlatform("claude", false, ".opencode/templates", "programming");
    const result = validatePlatform("claude", ".opencode/templates", "testing");
    assert.ok(!result.clean, "domain mismatch should cause stale detection");
    assert.ok(result.issueCount > 0);
  });

  it("totalExpected reflects the number of agent + command entries (ralph fallback)", () => {
    generatePlatform("claude");
    const result = validatePlatform("claude");
    assert.equal(result.totalExpected, 4, "ralph fallback = 3 agents + 1 command");
  });

  it("domain-specific totalExpected reflects domain entry counts", () => {
    generatePlatform("claude", false, ".opencode/templates", "programming");
    const result = validatePlatform("claude", ".opencode/templates", "programming");
    assert.equal(result.totalExpected, 4);
  });

  it("no-domain (ralph fallback) detects missing ralph-* files", () => {
    // 不生成任何文件，直接 validate，应当报 ralph-* missing
    const result = validatePlatform("claude");
    const paths = result.issues.map((i) => i.path).sort();
    assert.ok(
      paths.some((p) => p.includes("ralph-orchestrator.md")),
      "missing list should include ralph-orchestrator.md (ralph fallback)",
    );
    assert.ok(
      paths.some((p) => p.includes("ralph-loop.md")),
      "missing list should include ralph-loop.md (ralph fallback)",
    );
  });
});

describe("formatValidateResult", () => {
  it("formats clean result with success message", () => {
    const result = {
      platform: "claude",
      domain: undefined,
      totalExpected: 4,
      issues: [],
      issueCount: 0,
      clean: true,
    };
    const output = formatValidateResult(result);
    assert.ok(output.includes("验证平台: claude"));
    assert.ok(output.includes("预期文件: 4 个"));
    assert.ok(output.includes("✅") || output.includes("一致"));
  });

  it("formats result with issues", () => {
    const result = {
      platform: "claude",
      domain: "programming",
      totalExpected: 4,
      issues: [
        { path: ".claude/agents/code-orchestrator.md", type: "stale" as const, message: "第 3 行不一致" },
        { path: ".claude/commands/code-loop.md", type: "missing" as const, message: "预期文件不存在于磁盘" },
      ],
      issueCount: 2,
      clean: false,
    };
    const output = formatValidateResult(result);
    assert.ok(output.includes("验证平台: claude (领域: programming)"));
    assert.ok(output.includes("❌") || output.includes("问题"));
    assert.ok(output.includes("已过期"));
    assert.ok(output.includes("缺失"));
  });

  it("includes extra file grouping", () => {
    const result = {
      platform: "opencode",
      domain: undefined,
      totalExpected: 4,
      issues: [
        { path: ".opencode/agents/custom.md", type: "extra" as const, message: "磁盘上存在但预期中无此文件" },
      ],
      issueCount: 1,
      clean: false,
    };
    const output = formatValidateResult(result);
    assert.ok(output.includes("多余"));
  });
});
