import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
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
    generatePlatform("claude", { domain: "coding" });
    const result = validatePlatform("claude", ".opencode/templates", "testing");
    assert.ok(!result.clean, "domain mismatch should cause stale detection");
    assert.ok(result.issueCount > 0);
  });

  it("does not report stale when disk files use CRLF (Windows autocrlf)", () => {
    // 生成产物按 LF 写盘；模拟 Windows git autocrlf 把磁盘文件转成 CRLF。
    generatePlatform("claude");
    for (const sub of ["agents", "commands"]) {
      const dir = join(process.cwd(), ".claude", sub);
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        writeFileSync(p, readFileSync(p, "utf-8").replace(/\n/g, "\r\n"), "utf-8");
      }
    }
    // 仅换行符差异不应被判为 stale
    const result = validatePlatform("claude");
    assert.ok(
      result.clean,
      `CRLF-only difference must not be stale, got: ${JSON.stringify(result.issues)}`,
    );
    assert.equal(result.issueCount, 0);
  });

  it("totalExpected reflects the number of agent + command entries (ralph fallback)", () => {
    generatePlatform("claude");
    const result = validatePlatform("claude");
    assert.equal(result.totalExpected, 4, "ralph fallback = 3 agents + 1 command");
  });

  it("domain-specific totalExpected reflects domain entry counts", () => {
    generatePlatform("claude", { domain: "coding" });
    const result = validatePlatform("claude", ".opencode/templates", "coding");
    assert.equal(result.totalExpected, 4);
  });

  it("graph domain validates clean after generate (routing_table parity)", () => {
    // 路由表已外置到 .loop-cli/routing-tables/default.json，不再注入命令 markdown。
    // validate 只逐字节比对 .md 文件，generate/validate 共用同一 render 路径，
    // parity 自动保持——graph 领域刚生成即应 validate clean。
    generatePlatform("claude", { domain: "graph" });
    const result = validatePlatform("claude", ".opencode/templates", "graph");
    assert.ok(
      result.clean,
      `graph domain should validate clean right after generate, got: ${JSON.stringify(result.issues)}`,
    );
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
      domain: "coding",
      totalExpected: 4,
      issues: [
        {
          path: ".claude/agents/coding-orchestrator.md",
          type: "stale" as const,
          message: "第 3 行不一致",
        },
        {
          path: ".claude/commands/coding-loop.md",
          type: "missing" as const,
          message: "预期文件不存在于磁盘",
        },
      ],
      issueCount: 2,
      clean: false,
    };
    const output = formatValidateResult(result);
    assert.ok(output.includes("验证平台: claude (领域: coding)"));
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
        {
          path: ".opencode/agents/custom.md",
          type: "extra" as const,
          message: "磁盘上存在但预期中无此文件",
        },
      ],
      issueCount: 1,
      clean: false,
    };
    const output = formatValidateResult(result);
    assert.ok(output.includes("多余"));
  });
});
