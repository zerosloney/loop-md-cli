import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { validatePlatform, formatValidateResult } from "../validate.js";
import { generatePlatform, defaultDomain } from "../generate.js";
import { AGENTS, COMMANDS } from "../registry.js";

// ─── Core validation logic tests ───

describe("validatePlatform", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), "loop-forge-validate-test-"));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it("reports all files as missing when platform dir does not exist", () => {
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

  it("totalExpected reflects the number of agent + command entries", () => {
    generatePlatform("claude");
    const result = validatePlatform("claude");
    assert.equal(result.totalExpected, 4);
  });

  it("domain-specific totalExpected reflects domain entry counts", () => {
    generatePlatform("claude", false, ".opencode/templates", "programming");
    const result = validatePlatform("claude", ".opencode/templates", "programming");
    assert.equal(result.totalExpected, 4);
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
        { path: ".claude/agents/orchestrator.md", type: "stale" as const, message: "第 3 行不一致" },
        { path: ".claude/commands/loop.md", type: "missing" as const, message: "预期文件不存在于磁盘" },
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

// ─── 缺陷 E 回归：defaultDomain 与 AGENTS/COMMANDS 单一真相源同步 ───
// 旧实现 validate.ts 硬编码了一份描述，与 generate.ts 的 defaultDomain 各自维护。
// 现在两路都复用 generate.ts 导出的 defaultDomain()，描述统一从 registry 取。
// 这条测试确保未来有人改 registry 的描述时，defaultDomain 自动跟随——
// 如果有人重新引入硬编码分支，测试会立即失败。
describe("defaultDomain (single source of truth)", () => {
  it("agent descriptions match AGENTS registry", () => {
    const d = defaultDomain();
    for (const a of d.agents) {
      assert.equal(
        a.description,
        AGENTS[a.role].description,
        `defaultDomain agent "${a.name}" description must match AGENTS["${a.role}"]`,
      );
    }
  });

  it("command description matches COMMANDS registry", () => {
    const d = defaultDomain();
    for (const c of d.commands) {
      // defaultDomain 的 command name 是 "loop"，对应 COMMANDS.loop
      assert.equal(
        c.description,
        COMMANDS.loop.description,
        "defaultDomain loop command description must match COMMANDS.loop",
      );
    }
  });

  it("uses role names as agent names in default (no-domain) mode", () => {
    const d = defaultDomain();
    const names = d.agents.map((a) => a.name).sort();
    assert.deepEqual(names, ["executor", "orchestrator", "reviewer"]);
  });
});
