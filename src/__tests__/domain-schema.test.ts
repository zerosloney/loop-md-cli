import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { validateDomainFields } from "../domain-schema.js";
import { readDomainFile } from "../domain-schema.js";

describe("domain-schema validation", () => {
  // ─── validateDomainFields ───

  it("rejects non-object input", () => {
    assert.deepEqual(validateDomainFields(null), [
      { field: ".", message: "领域文件必须是一个 JSON 对象" },
    ]);
    assert.deepEqual(validateDomainFields("string"), [
      { field: ".", message: "领域文件必须是一个 JSON 对象" },
    ]);
    assert.deepEqual(validateDomainFields(42), [
      { field: ".", message: "领域文件必须是一个 JSON 对象" },
    ]);
    assert.deepEqual(validateDomainFields([]), [
      { field: ".", message: "领域文件必须是一个 JSON 对象" },
    ]);
  });

  it("rejects missing id", () => {
    const errors = validateDomainFields({ agents: [], commands: [], engine: { type: "loop" } });
    assert.ok(errors.some((e) => e.field === "id" && e.message.includes("非空字符串")));
  });

  it("rejects empty id", () => {
    const errors = validateDomainFields({
      id: "",
      agents: [],
      commands: [],
      engine: { type: "loop" },
    });
    assert.ok(errors.some((e) => e.field === "id" && e.message.includes("非空字符串")));
  });

  it("rejects whitespace-only id", () => {
    const errors = validateDomainFields({
      id: "   ",
      agents: [],
      commands: [],
      engine: { type: "loop" },
    });
    assert.ok(errors.some((e) => e.field === "id" && e.message.includes("非空字符串")));
  });

  it("accepts valid id", () => {
    const errors = validateDomainFields({
      id: "my-domain",
      agents: [],
      commands: [],
      engine: { type: "loop" },
    });
    assert.equal(errors.filter((e) => e.field === "id").length, 0);
  });

  // ── engine validation ──

  it("rejects missing engine", () => {
    const errors = validateDomainFields({ id: "test", agents: [], commands: [] });
    assert.ok(errors.some((e) => e.field === "engine" && e.message.includes("必填")));
  });

  it("rejects non-object engine", () => {
    const errors = validateDomainFields({
      id: "test",
      engine: "not-object",
      agents: [],
      commands: [],
    });
    assert.ok(errors.some((e) => e.field === "engine" && e.message.includes("对象")));
  });

  it("rejects missing engine.type", () => {
    const errors = validateDomainFields({ id: "test", engine: {}, agents: [], commands: [] });
    assert.ok(errors.some((e) => e.field === "engine.type" && e.message.includes("必填")));
  });

  it("rejects unknown engine.type", () => {
    const errors = validateDomainFields({
      id: "test",
      engine: { type: "spiral" },
      agents: [],
      commands: [],
    });
    assert.ok(errors.some((e) => e.field === "engine.type" && e.message.includes("loop")));
  });

  // ── agents validation ──

  it("rejects missing agents array", () => {
    const errors = validateDomainFields({ id: "test", engine: { type: "loop" }, commands: [] });
    assert.ok(errors.some((e) => e.field === "agents" && e.message.includes("数组")));
  });

  it("rejects non-array agents", () => {
    const errors = validateDomainFields({
      id: "test",
      engine: { type: "loop" },
      agents: "not-array",
      commands: [],
    });
    assert.ok(errors.some((e) => e.field === "agents" && e.message.includes("数组")));
  });

  it("rejects agent with unknown role", () => {
    const errors = validateDomainFields({
      id: "test",
      engine: { type: "loop" },
      agents: [{ role: "unknown-role", name: "x", description: "y" }],
      commands: [],
    });
    assert.ok(errors.some((e) => e.field === "agents[0].role" && e.message.includes("已知角色")));
  });

  it("rejects agent with missing name", () => {
    const errors = validateDomainFields({
      id: "test",
      engine: { type: "loop" },
      agents: [{ role: "orchestrator", description: "y" }],
      commands: [],
    });
    assert.ok(errors.some((e) => e.field === "agents[0].name" && e.message.includes("非空字符串")));
  });

  it("rejects agent with empty name", () => {
    const errors = validateDomainFields({
      id: "test",
      engine: { type: "loop" },
      agents: [{ role: "orchestrator", name: "", description: "y" }],
      commands: [],
    });
    assert.ok(errors.some((e) => e.field === "agents[0].name" && e.message.includes("非空字符串")));
  });

  it("rejects agent with whitespace name", () => {
    const errors = validateDomainFields({
      id: "test",
      engine: { type: "loop" },
      agents: [{ role: "orchestrator", name: "   ", description: "y" }],
      commands: [],
    });
    assert.ok(errors.some((e) => e.field === "agents[0].name" && e.message.includes("非空字符串")));
  });

  it("rejects agent with missing description", () => {
    const errors = validateDomainFields({
      id: "test",
      engine: { type: "loop" },
      agents: [{ role: "orchestrator", name: "x" }],
      commands: [],
    });
    assert.ok(
      errors.some((e) => e.field === "agents[0].description" && e.message.includes("非空字符串")),
    );
  });

  it("rejects agent with null entry", () => {
    const errors = validateDomainFields({
      id: "test",
      engine: { type: "loop" },
      agents: [null as unknown as { role: string; name: string; description: string }],
      commands: [],
    });
    assert.ok(errors.some((e) => e.field === "agents[0]" && e.message.includes("对象")));
  });

  it("rejects duplicate agent names", () => {
    const errors = validateDomainFields({
      id: "test",
      engine: { type: "loop" },
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
      engine: { type: "loop" },
      agents: [{ role: "executor", name: "builder", description: "desc" }],
      commands: [],
    });
    assert.ok(errors.some((e) => e.field === "agents" && e.message.includes("orchestrator")));
  });

  it("accepts valid agent with known role", () => {
    for (const role of ["orchestrator", "executor", "reviewer"]) {
      const errors = validateDomainFields({
        id: "test",
        engine: { type: "loop" },
        agents: [{ role, name: "my-agent", description: "desc" }],
        commands: [],
      });
      const roleErrors = errors.filter((e) => e.field.startsWith("agents[0].role"));
      assert.equal(roleErrors.length, 0, `role=${role} should be valid`);
    }
  });

  // ── commands validation ──

  it("rejects missing commands array", () => {
    const errors = validateDomainFields({ id: "test", engine: { type: "loop" }, agents: [] });
    assert.ok(errors.some((e) => e.field === "commands" && e.message.includes("数组")));
  });

  it("rejects command with unknown kind", () => {
    const errors = validateDomainFields({
      id: "test",
      engine: { type: "loop" },
      agents: [{ role: "orchestrator", name: "ctrl", description: "y" }],
      commands: [{ kind: "unknown", agent: "ctrl", name: "x", description: "y" }],
    });
    assert.ok(errors.some((e) => e.field === "commands[0].kind" && e.message.includes("entry")));
  });

  it("rejects command with missing kind", () => {
    const errors = validateDomainFields({
      id: "test",
      engine: { type: "loop" },
      agents: [{ role: "orchestrator", name: "ctrl", description: "y" }],
      commands: [{ agent: "ctrl", name: "x", description: "y" }],
    });
    assert.ok(errors.some((e) => e.field === "commands[0].kind" && e.message.includes("必填")));
  });

  it("rejects command with missing agent", () => {
    const errors = validateDomainFields({
      id: "test",
      engine: { type: "loop" },
      agents: [{ role: "orchestrator", name: "ctrl", description: "y" }],
      commands: [{ kind: "entry", name: "x", description: "y" }],
    });
    assert.ok(errors.some((e) => e.field === "commands[0].agent" && e.message.includes("必填")));
  });

  it("rejects command with agent not in agents", () => {
    const errors = validateDomainFields({
      id: "test",
      engine: { type: "loop" },
      agents: [{ role: "orchestrator", name: "ctrl", description: "y" }],
      commands: [{ kind: "entry", agent: "ghost", name: "x", description: "y" }],
    });
    assert.ok(errors.some((e) => e.field === "commands[0].agent" && e.message.includes("不存在")));
  });

  it("rejects command with missing name", () => {
    const errors = validateDomainFields({
      id: "test",
      engine: { type: "loop" },
      agents: [{ role: "orchestrator", name: "ctrl", description: "y" }],
      commands: [{ kind: "entry", agent: "ctrl", description: "y" }],
    });
    assert.ok(
      errors.some((e) => e.field === "commands[0].name" && e.message.includes("非空字符串")),
    );
  });

  it("rejects command with missing description", () => {
    const errors = validateDomainFields({
      id: "test",
      engine: { type: "loop" },
      agents: [{ role: "orchestrator", name: "ctrl", description: "y" }],
      commands: [{ kind: "entry", agent: "ctrl", name: "x" }],
    });
    assert.ok(
      errors.some((e) => e.field === "commands[0].description" && e.message.includes("非空字符串")),
    );
  });

  it("rejects duplicate command names", () => {
    const errors = validateDomainFields({
      id: "test",
      engine: { type: "loop" },
      agents: [{ role: "orchestrator", name: "ctrl", description: "y" }],
      commands: [
        { kind: "entry", agent: "ctrl", name: "my-loop", description: "desc" },
        { kind: "entry", agent: "ctrl", name: "my-loop", description: "desc2" },
      ],
    });
    assert.ok(errors.some((e) => e.field === "commands[1].name" && e.message.includes("重复")));
  });

  it("rejects missing entry command", () => {
    const errors = validateDomainFields({
      id: "test",
      engine: { type: "loop" },
      agents: [{ role: "orchestrator", name: "ctrl", description: "y" }],
      commands: [{ kind: "other", agent: "ctrl", name: "x", description: "y" }],
    });
    assert.ok(errors.some((e) => e.field === "commands" && e.message.includes("entry")));
  });

  it("accepts valid command with entry kind", () => {
    const errors = validateDomainFields({
      id: "test",
      engine: { type: "loop" },
      agents: [{ role: "orchestrator", name: "ctrl", description: "y" }],
      commands: [{ kind: "entry", agent: "ctrl", name: "my-loop", description: "desc" }],
    });
    const kindErrors = errors.filter((e) => e.field === "commands[0].kind");
    assert.equal(kindErrors.length, 0);
  });

  // ─── Full valid domain ───

  it("accepts a fully valid domain", () => {
    const errors = validateDomainFields({
      id: "writing",
      engine: { type: "loop" },
      agents: [
        { role: "orchestrator", name: "writing-orchestrator", description: "写作主控" },
        { role: "executor", name: "writing-author", description: "写作执行者" },
        { role: "reviewer", name: "writing-reviewer", description: "写作审查者" },
      ],
      commands: [
        {
          kind: "entry",
          agent: "writing-orchestrator",
          name: "writing-loop",
          description: "写作闭环",
        },
      ],
    });
    assert.equal(errors.length, 0, "fully valid domain should have no errors");
  });

  // ─── readDomainFile ───

  it("throws on invalid JSON", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "loop-md-cli-schema-test-"));
    try {
      const badFile = join(tmpDir, "bad.json");
      writeFileSync(badFile, "{ not valid json }");
      assert.throws(() => readDomainFile(badFile), /JSON 解析失败/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws on missing file", () => {
    assert.throws(
      () => readDomainFile("/nonexistent/path/does-not-exist.json"),
      /无法读取领域文件/,
    );
  });

  it("throws on schema validation failure", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "loop-md-cli-schema-test-"));
    try {
      const badFile = join(tmpDir, "bad.json");
      writeFileSync(
        badFile,
        JSON.stringify({ id: "", agents: [], commands: [], engine: { type: "loop" } }),
      );
      assert.throws(() => readDomainFile(badFile), /校验失败/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws on missing orchestrator", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "loop-md-cli-schema-test-"));
    try {
      const file = join(tmpDir, "no-orchestrator.json");
      writeFileSync(
        file,
        JSON.stringify({
          id: "test",
          engine: { type: "loop" },
          agents: [{ role: "executor", name: "builder", description: "desc" }],
          commands: [{ kind: "entry", agent: "builder", name: "my-loop", description: "desc" }],
        }),
      );
      assert.throws(() => readDomainFile(file), /orchestrator/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws on missing entry command", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "loop-md-cli-schema-test-"));
    try {
      const file = join(tmpDir, "no-entry.json");
      writeFileSync(
        file,
        JSON.stringify({
          id: "test",
          engine: { type: "loop" },
          agents: [{ role: "orchestrator", name: "ctrl", description: "desc" }],
          commands: [{ kind: "other", agent: "ctrl", name: "other-cmd", description: "desc" }],
        }),
      );
      assert.throws(() => readDomainFile(file), /entry/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns ResolvedDomain on valid file", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "loop-md-cli-schema-test-"));
    try {
      const file = join(tmpDir, "valid.json");
      writeFileSync(
        file,
        JSON.stringify({
          id: "writing",
          engine: { type: "loop" },
          agents: [
            { role: "orchestrator", name: "writing-orchestrator", description: "写作主控" },
            { role: "executor", name: "writing-author", description: "写作执行者" },
            { role: "reviewer", name: "writing-reviewer", description: "写作审查者" },
          ],
          commands: [
            {
              kind: "entry",
              agent: "writing-orchestrator",
              name: "writing-loop",
              description: "写作闭环",
            },
          ],
        }),
      );
      const domain = readDomainFile(file);
      assert.equal(domain.id, "writing");
      assert.equal(domain.engine.type, "loop");
      assert.equal(domain.agents.length, 3);
      assert.equal(domain.commands.length, 1);
      assert.equal(domain.agents[0].name, "writing-orchestrator");
      assert.equal(domain.commands[0].name, "writing-loop");
      assert.equal(domain.commands[0].kind, "entry");
      assert.equal(domain.commands[0].agent, "writing-orchestrator");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws on duplicate agent names", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "loop-md-cli-schema-test-"));
    try {
      const file = join(tmpDir, "dup.json");
      writeFileSync(
        file,
        JSON.stringify({
          id: "test",
          engine: { type: "loop" },
          agents: [
            { role: "orchestrator", name: "same-name", description: "desc" },
            { role: "executor", name: "same-name", description: "desc2" },
          ],
          commands: [{ kind: "entry", agent: "same-name", name: "my-loop", description: "desc" }],
        }),
      );
      assert.throws(() => readDomainFile(file), /重复/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws on multiple validation errors", () => {
    const errors = validateDomainFields({
      id: "",
      engine: { type: "wrong" },
      agents: [{ role: "bad-role", name: "", description: "" }, null],
      commands: "not-an-array",
    });
    // Should have multiple errors: id, engine.type, agents[0].role, agents[0].name, agents[0].description, agents[1], commands
    assert.ok(errors.length > 1, "should report multiple errors");
    assert.ok(
      errors.some((e) => e.field === "id"),
      "should report id error",
    );
    assert.ok(
      errors.some((e) => e.field === "engine.type"),
      "should report engine.type error",
    );
    assert.ok(
      errors.some((e) => e.field === "agents[0].role"),
      "should report role error",
    );
    assert.ok(
      errors.some((e) => e.field === "commands") &&
        errors.find((e) => e.field === "commands")?.message?.includes("数组"),
      "should report commands type error",
    );
  });

  // ── graph engine type ──

  it("accepts engine.type=graph", () => {
    const errors = validateDomainFields({
      id: "my-graph",
      engine: { type: "graph" },
      agents: [{ role: "orchestrator", name: "orchestrator", description: "main" }],
      commands: [{ kind: "entry", agent: "orchestrator", name: "my-graph", description: "cmd" }],
    });
    const engineErrors = errors.filter((e) => e.field === "engine.type");
    assert.equal(engineErrors.length, 0);
  });

  it("rejects engine.type=graph when tasks is missing", () => {
    const errors = validateDomainFields({
      id: "my-graph",
      engine: { type: "graph" },
      agents: [{ role: "orchestrator", name: "orchestrator", description: "main" }],
      commands: [{ kind: "entry", agent: "orchestrator", name: "my-graph", description: "cmd" }],
    });
    assert.ok(errors.some((e) => e.field === "tasks" && e.message.includes("graph 时必填")));
  });

  it("accepts engine.type=graph with valid tasks", () => {
    const errors = validateDomainFields({
      id: "my-graph",
      engine: { type: "graph" },
      agents: [{ role: "orchestrator", name: "orchestrator", description: "main" }],
      commands: [{ kind: "entry", agent: "orchestrator", name: "my-graph", description: "cmd" }],
      tasks: [
        { id: "t1", title: "Task 1", depends_on: [] },
        { id: "t2", title: "Task 2", depends_on: ["t1"] },
      ],
    });
    assert.equal(
      errors.filter((e) => !e.field.startsWith(".")).length,
      0,
      `unexpected errors: ${JSON.stringify(errors)}`,
    );
  });

  it("rejects empty tasks array", () => {
    const errors = validateDomainFields({
      id: "my-graph",
      engine: { type: "graph" },
      agents: [{ role: "orchestrator", name: "orchestrator", description: "main" }],
      commands: [{ kind: "entry", agent: "orchestrator", name: "my-graph", description: "cmd" }],
      tasks: [],
    });
    assert.ok(
      errors.some((e) => e.field === "tasks" && e.message.includes("至少需要 1 个任务")),
    );
  });

  it("rejects task with empty id", () => {
    const errors = validateDomainFields({
      id: "my-graph",
      engine: { type: "graph" },
      agents: [{ role: "orchestrator", name: "orchestrator", description: "main" }],
      commands: [{ kind: "entry", agent: "orchestrator", name: "my-graph", description: "cmd" }],
      tasks: [{ id: "", title: "No ID", depends_on: [] }],
    });
    assert.ok(errors.some((e) => e.field === "tasks[0].id" && e.message.includes("非空字符串")));
  });

  it("rejects task with empty title", () => {
    const errors = validateDomainFields({
      id: "my-graph",
      engine: { type: "graph" },
      agents: [{ role: "orchestrator", name: "orchestrator", description: "main" }],
      commands: [{ kind: "entry", agent: "orchestrator", name: "my-graph", description: "cmd" }],
      tasks: [{ id: "t1", title: "", depends_on: [] }],
    });
    assert.ok(
      errors.some((e) => e.field === "tasks[0].title" && e.message.includes("非空字符串")),
    );
  });

  it("rejects accept_criteria that is not an array", () => {
    const errors = validateDomainFields({
      id: "my-graph",
      engine: { type: "graph" },
      agents: [{ role: "orchestrator", name: "orchestrator", description: "main" }],
      commands: [{ kind: "entry", agent: "orchestrator", name: "my-graph", description: "cmd" }],
      tasks: [{ id: "t1", title: "Task 1", depends_on: [], accept_criteria: "not-array" }],
    });
    assert.ok(
      errors.some((e) => e.field === "tasks[0].accept_criteria" && e.message.includes("必须是数组")),
    );
  });

  it("rejects accept_criteria with non-string elements", () => {
    const errors = validateDomainFields({
      id: "my-graph",
      engine: { type: "graph" },
      agents: [{ role: "orchestrator", name: "orchestrator", description: "main" }],
      commands: [{ kind: "entry", agent: "orchestrator", name: "my-graph", description: "cmd" }],
      tasks: [{ id: "t1", title: "Task 1", depends_on: [], accept_criteria: ["ok", 123] }],
    });
    assert.ok(
      errors.some(
        (e) => e.field === "tasks[0].accept_criteria[1]" && e.message.includes("非空字符串"),
      ),
    );
  });

  it("rejects duplicate task IDs", () => {
    const errors = validateDomainFields({
      id: "my-graph",
      engine: { type: "graph" },
      agents: [{ role: "orchestrator", name: "orchestrator", description: "main" }],
      commands: [{ kind: "entry", agent: "orchestrator", name: "my-graph", description: "cmd" }],
      tasks: [
        { id: "t1", title: "Task 1", depends_on: [] },
        { id: "t1", title: "Task 1 again", depends_on: [] },
      ],
    });
    assert.ok(errors.some((e) => e.field === "tasks[1].id" && e.message.includes("重复")));
  });

  it("rejects depends_on reference to non-existent task ID", () => {
    const errors = validateDomainFields({
      id: "my-graph",
      engine: { type: "graph" },
      agents: [{ role: "orchestrator", name: "orchestrator", description: "main" }],
      commands: [{ kind: "entry", agent: "orchestrator", name: "my-graph", description: "cmd" }],
      tasks: [
        { id: "t1", title: "Task 1", depends_on: [] },
        { id: "t2", title: "Task 2", depends_on: ["t1", "nonexistent"] },
      ],
    });
    assert.ok(
      errors.some(
        (e) => e.field === "tasks[1].depends_on[1]" && e.message.includes("不是有效的任务 ID"),
      ),
    );
  });

  it("rejects circular dependency", () => {
    const errors = validateDomainFields({
      id: "my-graph",
      engine: { type: "graph" },
      agents: [{ role: "orchestrator", name: "orchestrator", description: "main" }],
      commands: [{ kind: "entry", agent: "orchestrator", name: "my-graph", description: "cmd" }],
      tasks: [
        { id: "t1", title: "Task 1", depends_on: ["t3"] },
        { id: "t2", title: "Task 2", depends_on: ["t1"] },
        { id: "t3", title: "Task 3", depends_on: ["t2"] },
      ],
    });
    assert.ok(errors.some((e) => e.field === "tasks" && e.message.includes("循环依赖")));
  });

  it("accepts non-circular DAG (T1 → T2 & T3 → T4)", () => {
    const errors = validateDomainFields({
      id: "my-graph",
      engine: { type: "graph" },
      agents: [{ role: "orchestrator", name: "orchestrator", description: "main" }],
      commands: [{ kind: "entry", agent: "orchestrator", name: "my-graph", description: "cmd" }],
      tasks: [
        { id: "t1", title: "Task 1", depends_on: [] },
        { id: "t2", title: "Task 2", depends_on: ["t1"] },
        { id: "t3", title: "Task 3", depends_on: ["t1"] },
        { id: "t4", title: "Task 4", depends_on: ["t2", "t3"] },
      ],
    });
    assert.equal(
      errors.filter((e) => !e.field.startsWith(".")).length,
      0,
      `unexpected errors: ${JSON.stringify(errors)}`,
    );
  });

  // ── readDomainFile with graph ──

  it("readDomainFile parses graph domain correctly", () => {
    const dir = join(tmpdir(), "loop-md-graph-test");
    mkdirSync(dir, { recursive: true });
    const domainPath = join(dir, "graph-domain.json");
    writeFileSync(
      domainPath,
      JSON.stringify({
        id: "my-graph",
        engine: { type: "graph" },
        agents: [{ role: "orchestrator", name: "orchestrator", description: "main" }],
        commands: [{ kind: "entry", agent: "orchestrator", name: "my-graph", description: "cmd" }],
        tasks: [
          { id: "t1", title: "Task 1", depends_on: [], accept_criteria: ["must work"] },
          { id: "t2", title: "Task 2", depends_on: ["t1"] },
        ],
      }),
    );
    const domain = readDomainFile(domainPath);
    assert.equal(domain.engine.type, "graph");
    assert.ok(domain.tasks !== undefined);
    assert.equal(domain.tasks!.length, 2);
    assert.equal(domain.tasks![0].id, "t1");
    assert.deepEqual(domain.tasks![0].depends_on, []);
    assert.deepEqual(domain.tasks![0].accept_criteria, ["must work"]);
    assert.equal(domain.tasks![1].id, "t2");
    assert.deepEqual(domain.tasks![1].depends_on, ["t1"]);
    // cleanup
    rmSync(dir, { recursive: true, force: true });
  });

  it("readDomainFile handles domain without tasks (loop mode)", () => {
    const dir = join(tmpdir(), "loop-md-no-tasks-test");
    mkdirSync(dir, { recursive: true });
    const domainPath = join(dir, "loop-domain.json");
    writeFileSync(
      domainPath,
      JSON.stringify({
        id: "my-loop",
        engine: { type: "loop" },
        agents: [{ role: "orchestrator", name: "orchestrator", description: "main" }],
        commands: [{ kind: "entry", agent: "orchestrator", name: "my-loop", description: "cmd" }],
      }),
    );
    const domain = readDomainFile(domainPath);
    assert.equal(domain.engine.type, "loop");
    assert.equal(domain.tasks, undefined);
    // cleanup
    rmSync(dir, { recursive: true, force: true });
  });

  it("loop domain with tasks: validation passes, tasks parsed but generation ignores them", () => {
    // 行为契约：loop 域携带 tasks 时不报错（结构校验仍生效），readDomainFile 正常解析，
    // 但 generatePlatform 仅在 engineType=graph 时注入 routing_table，loop 域不会使用 tasks。
    const errors = validateDomainFields({
      id: "my-loop",
      engine: { type: "loop" },
      agents: [{ role: "orchestrator", name: "orchestrator", description: "main" }],
      commands: [{ kind: "entry", agent: "orchestrator", name: "my-loop", description: "cmd" }],
      tasks: [{ id: "t1", title: "Task 1", depends_on: [] }],
    });
    assert.equal(
      errors.filter((e) => !e.field.startsWith(".")).length,
      0,
      `loop domain with valid tasks should pass validation: ${JSON.stringify(errors)}`,
    );
  });
});
