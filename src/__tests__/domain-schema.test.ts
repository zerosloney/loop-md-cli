import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";

import { validateDomainFields } from "../domain-schema.js";
import { readDomainFile } from "../domain-schema.js";

describe("domain-schema validation", () => {
  // ─── validateDomainFields ───

  it("rejects non-object input", () => {
    assert.deepEqual(validateDomainFields(null), [{ field: ".", message: "领域文件必须是一个 JSON 对象" }]);
    assert.deepEqual(validateDomainFields("string"), [{ field: ".", message: "领域文件必须是一个 JSON 对象" }]);
    assert.deepEqual(validateDomainFields(42), [{ field: ".", message: "领域文件必须是一个 JSON 对象" }]);
    assert.deepEqual(validateDomainFields([]), [{ field: ".", message: "领域文件必须是一个 JSON 对象" }]);
  });

  it("rejects missing id", () => {
    const errors = validateDomainFields({ agents: [], commands: [] });
    assert.ok(errors.some((e) => e.field === "id" && e.message.includes("非空字符串")));
  });

  it("rejects empty id", () => {
    const errors = validateDomainFields({ id: "", agents: [], commands: [] });
    assert.ok(errors.some((e) => e.field === "id" && e.message.includes("非空字符串")));
  });

  it("rejects whitespace-only id", () => {
    const errors = validateDomainFields({ id: "   ", agents: [], commands: [] });
    assert.ok(errors.some((e) => e.field === "id" && e.message.includes("非空字符串")));
  });

  it("accepts valid id", () => {
    const errors = validateDomainFields({ id: "my-domain", agents: [], commands: [] });
    assert.equal(errors.filter((e) => e.field === "id").length, 0);
  });

  // ── agents validation ──

  it("rejects missing agents array", () => {
    const errors = validateDomainFields({ id: "test", commands: [] });
    assert.ok(errors.some((e) => e.field === "agents" && e.message.includes("数组")));
  });

  it("rejects non-array agents", () => {
    const errors = validateDomainFields({ id: "test", agents: "not-array", commands: [] });
    assert.ok(errors.some((e) => e.field === "agents" && e.message.includes("数组")));
  });

  it("rejects agent with unknown role", () => {
    const errors = validateDomainFields({
      id: "test",
      agents: [{ role: "unknown-role", name: "x", description: "y" }],
      commands: [],
    });
    assert.ok(errors.some((e) => e.field === "agents[0].role" && e.message.includes("已知角色")));
  });

  it("rejects agent with missing name", () => {
    const errors = validateDomainFields({
      id: "test",
      agents: [{ role: "orchestrator", description: "y" }],
      commands: [],
    });
    assert.ok(errors.some((e) => e.field === "agents[0].name" && e.message.includes("非空字符串")));
  });

  it("rejects agent with empty name", () => {
    const errors = validateDomainFields({
      id: "test",
      agents: [{ role: "orchestrator", name: "", description: "y" }],
      commands: [],
    });
    assert.ok(errors.some((e) => e.field === "agents[0].name" && e.message.includes("非空字符串")));
  });

  it("rejects agent with whitespace name", () => {
    const errors = validateDomainFields({
      id: "test",
      agents: [{ role: "orchestrator", name: "   ", description: "y" }],
      commands: [],
    });
    assert.ok(errors.some((e) => e.field === "agents[0].name" && e.message.includes("非空字符串")));
  });

  it("rejects agent with missing description", () => {
    const errors = validateDomainFields({
      id: "test",
      agents: [{ role: "orchestrator", name: "x" }],
      commands: [],
    });
    assert.ok(errors.some((e) => e.field === "agents[0].description" && e.message.includes("非空字符串")));
  });

  it("rejects agent with null entry", () => {
    const errors = validateDomainFields({
      id: "test",
      agents: [null as unknown as { role: string; name: string; description: string }],
      commands: [],
    });
    assert.ok(errors.some((e) => e.field === "agents[0]" && e.message.includes("对象")));
  });

  it("rejects duplicate agent names", () => {
    const errors = validateDomainFields({
      id: "test",
      agents: [
        { role: "orchestrator", name: "my-agent", description: "desc" },
        { role: "executor", name: "my-agent", description: "desc2" },
      ],
      commands: [],
    });
    assert.ok(errors.some((e) => e.field === "agents[1].name" && e.message.includes("重复")));
  });

  it("rejects missing orchestrator", () => {
    const errors = validateDomainFields({
      id: "test",
      agents: [{ role: "executor", name: "builder", description: "desc" }],
      commands: [],
    });
    assert.ok(errors.some((e) => e.field === "agents" && e.message.includes("orchestrator")));
  });

  it("accepts valid agent with known role", () => {
    for (const role of ["orchestrator", "executor", "reviewer"]) {
      const errors = validateDomainFields({
        id: "test",
        agents: [{ role, name: "my-agent", description: "desc" }],
        commands: [],
      });
      const roleErrors = errors.filter((e) => e.field.startsWith("agents[0].role"));
      assert.equal(roleErrors.length, 0, `role=${role} should be valid`);
    }
  });

  // ── commands validation ──

  it("rejects missing commands array", () => {
    const errors = validateDomainFields({ id: "test", agents: [] });
    assert.ok(errors.some((e) => e.field === "commands" && e.message.includes("数组")));
  });

  it("rejects command with unknown role", () => {
    const errors = validateDomainFields({
      id: "test",
      agents: [],
      commands: [{ role: "unknown", name: "x", description: "y" }],
    });
    assert.ok(errors.some((e) => e.field === "commands[0].role" && e.message.includes("已知角色")));
  });

  it("rejects command with missing name", () => {
    const errors = validateDomainFields({
      id: "test",
      agents: [],
      commands: [{ role: "loop", description: "y" }],
    });
    assert.ok(errors.some((e) => e.field === "commands[0].name" && e.message.includes("非空字符串")));
  });

  it("rejects command with missing description", () => {
    const errors = validateDomainFields({
      id: "test",
      agents: [],
      commands: [{ role: "loop", name: "x" }],
    });
    assert.ok(errors.some((e) => e.field === "commands[0].description" && e.message.includes("非空字符串")));
  });

  it("rejects duplicate command names", () => {
    const errors = validateDomainFields({
      id: "test",
      agents: [],
      commands: [
        { role: "loop", name: "my-loop", description: "desc" },
        { role: "loop", name: "my-loop", description: "desc2" },
      ],
    });
    assert.ok(errors.some((e) => e.field === "commands[1].name" && e.message.includes("重复")));
  });

  it("rejects missing loop command", () => {
    const errors = validateDomainFields({
      id: "test",
      agents: [],
      commands: [{ role: "other", name: "x", description: "y" }],
    });
    assert.ok(errors.some((e) => e.field === "commands" && e.message.includes("loop")));
  });

  it("accepts valid command with loop role", () => {
    const errors = validateDomainFields({
      id: "test",
      agents: [],
      commands: [{ role: "loop", name: "my-loop", description: "desc" }],
    });
    const roleErrors = errors.filter((e) => e.field === "commands[0].role");
    assert.equal(roleErrors.length, 0);
  });

  // ─── Full valid domain ───

  it("accepts a fully valid domain", () => {
    const errors = validateDomainFields({
      id: "writing",
      agents: [
        { role: "orchestrator", name: "writing-orchestrator", description: "写作主控" },
        { role: "executor", name: "writing-author", description: "写作执行者" },
        { role: "reviewer", name: "writing-reviewer", description: "写作审查者" },
      ],
      commands: [{ role: "loop", name: "writing-loop", description: "写作闭环" }],
    });
    assert.equal(errors.length, 0, "fully valid domain should have no errors");
  });

  // ─── readDomainFile ───

  it("throws on invalid JSON", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "loop-forge-schema-test-"));
    try {
      const badFile = join(tmpDir, "bad.json");
      writeFileSync(badFile, "{ not valid json }");
      assert.throws(() => readDomainFile(badFile), /JSON 解析失败/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws on missing file", () => {
    assert.throws(() => readDomainFile("/nonexistent/path/does-not-exist.json"), /无法读取领域文件/);
  });

  it("throws on schema validation failure", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "loop-forge-schema-test-"));
    try {
      const badFile = join(tmpDir, "bad.json");
      writeFileSync(badFile, JSON.stringify({ id: "", agents: [], commands: [] }));
      assert.throws(() => readDomainFile(badFile), /校验失败/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws on missing orchestrator", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "loop-forge-schema-test-"));
    try {
      const file = join(tmpDir, "no-orchestrator.json");
      writeFileSync(file, JSON.stringify({
        id: "test",
        agents: [{ role: "executor", name: "builder", description: "desc" }],
        commands: [{ role: "loop", name: "my-loop", description: "desc" }],
      }));
      assert.throws(() => readDomainFile(file), /orchestrator/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws on missing loop command", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "loop-forge-schema-test-"));
    try {
      const file = join(tmpDir, "no-loop.json");
      writeFileSync(file, JSON.stringify({
        id: "test",
        agents: [{ role: "orchestrator", name: "ctrl", description: "desc" }],
        commands: [{ role: "other", name: "other-cmd", description: "desc" }],
      }));
      assert.throws(() => readDomainFile(file), /loop/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns ResolvedDomain on valid file", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "loop-forge-schema-test-"));
    try {
      const file = join(tmpDir, "valid.json");
      writeFileSync(file, JSON.stringify({
        id: "writing",
        agents: [
          { role: "orchestrator", name: "writing-orchestrator", description: "写作主控" },
          { role: "executor", name: "writing-author", description: "写作执行者" },
          { role: "reviewer", name: "writing-reviewer", description: "写作审查者" },
        ],
        commands: [{ role: "loop", name: "writing-loop", description: "写作闭环" }],
      }));
      const domain = readDomainFile(file);
      assert.equal(domain.id, "writing");
      assert.equal(domain.agents.length, 3);
      assert.equal(domain.commands.length, 1);
      assert.equal(domain.agents[0].name, "writing-orchestrator");
      assert.equal(domain.commands[0].name, "writing-loop");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws on duplicate agent names", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "loop-forge-schema-test-"));
    try {
      const file = join(tmpDir, "dup.json");
      writeFileSync(file, JSON.stringify({
        id: "test",
        agents: [
          { role: "orchestrator", name: "same-name", description: "desc" },
          { role: "executor", name: "same-name", description: "desc2" },
        ],
        commands: [{ role: "loop", name: "my-loop", description: "desc" }],
      }));
      assert.throws(() => readDomainFile(file), /重复/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws on multiple validation errors", () => {
    const errors = validateDomainFields({
      id: "",
      agents: [
        { role: "bad-role", name: "", description: "" },
        null,
      ],
      commands: "not-an-array",
    });
    // Should have multiple errors: id, agents[0].role, agents[0].name, agents[0].description, agents[1], commands
    assert.ok(errors.length > 1, "should report multiple errors");
    assert.ok(errors.some((e) => e.field === "id"), "should report id error");
    assert.ok(errors.some((e) => e.field === "agents[0].role"), "should report role error");
    assert.ok(errors.some((e) => e.field === "commands") && errors.find((e) => e.field === "commands")?.message?.includes("数组"), "should report commands type error");
  });
});
