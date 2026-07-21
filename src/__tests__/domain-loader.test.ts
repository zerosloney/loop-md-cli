import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

import { resolveDomains, findDomain, DOMAINS_DIR } from "../domain-loader.js";

describe("domain-loader", () => {
  it("includes all builtin domains by default", () => {
    const domains = resolveDomains();
    const ids = domains.map((d) => d.id);
    assert.ok(ids.includes("coding"));
    assert.ok(ids.includes("testing"));
    assert.ok(ids.includes("writing"));
    assert.ok(ids.includes("ralph"));
  });

  it("finds builtin domain by id", () => {
    const domains = resolveDomains();
    const d = findDomain(domains, "coding");
    assert.equal(d.id, "coding");
    assert.equal(d.engine.type, "loop");
    assert.ok(d.agents.some((a) => a.role === "orchestrator"));
    assert.ok(d.commands.some((c) => c.kind === "entry"));
  });

  it("finds writing domain", () => {
    const domains = resolveDomains();
    const writing = findDomain(domains, "writing");
    assert.equal(writing.id, "writing");
    assert.equal(writing.engine.type, "loop");
    assert.ok(writing.agents.some((a) => a.name === "writing-orchestrator"));
    assert.ok(writing.agents.some((a) => a.name === "writing-author"));
    assert.ok(writing.agents.some((a) => a.name === "writing-reviewer"));
    assert.ok(writing.commands.some((c) => c.name === "writing-loop"));
    // command 必填 agent 字段，显式声明驱动 writing-orchestrator
    const writingLoop = writing.commands.find((c) => c.name === "writing-loop");
    assert.equal(writingLoop?.agent, "writing-orchestrator");
    // writing 默认带 lint 弱门禁 backpressure（ralph 内核能力）
    assert.deepEqual(writing.backpressure, {
      type: "lint",
      command: "npm run lint",
      max_failures: 2,
      retry_on_failure: false,
    });
  });

  it("finds coding domain with backpressure", () => {
    const domains = resolveDomains();
    const coding = findDomain(domains, "coding");
    assert.equal(coding.id, "coding");
    assert.deepEqual(coding.backpressure, {
      type: "test",
      command: "npm test",
      max_failures: 3,
      retry_on_failure: true,
    });
    const codingLoop = coding.commands.find((c) => c.name === "coding-loop");
    assert.equal(codingLoop?.agent, "coding-orchestrator");
  });

  it("finds ralph domain with backpressure", () => {
    const domains = resolveDomains();
    const ralph = findDomain(domains, "ralph");
    assert.equal(ralph.id, "ralph");
    assert.equal(ralph.engine.type, "loop");
    assert.ok(ralph.agents.some((a) => a.name === "ralph-orchestrator"));
    assert.ok(ralph.agents.some((a) => a.name === "ralph-worker"));
    assert.ok(ralph.agents.some((a) => a.name === "ralph-reviewer"));
    assert.ok(ralph.commands.some((c) => c.name === "ralph-loop"));
    const ralphLoop = ralph.commands.find((c) => c.name === "ralph-loop");
    assert.equal(ralphLoop?.agent, "ralph-orchestrator");
    assert.deepEqual(ralph.backpressure, {
      type: "test",
      command: "npm test",
      max_failures: 3,
      retry_on_failure: true,
    });
  });

  it("throws on unknown domain", () => {
    const domains = resolveDomains();
    assert.throws(() => findDomain(domains, "nonexistent"), /未知领域/);
  });

  it("merges extra CLI domain files with override", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "loop-md-cli-domain-test-"));
    try {
      const extraFile = join(tmpDir, "my-custom-domain.json");
      writeFileSync(extraFile, JSON.stringify({
        id: "custom",
        engine: { type: "loop" },
        agents: [
          { role: "orchestrator", name: "custom-ctrl", description: "Custom orchestrator" },
        ],
        commands: [
          { kind: "entry", agent: "custom-ctrl", name: "custom-loop", description: "Custom loop" },
        ],
      }));

      const domains = resolveDomains([extraFile]);
      const custom = findDomain(domains, "custom");
      assert.equal(custom.id, "custom");
      assert.equal(custom.engine.type, "loop");
      assert.equal(custom.agents[0].name, "custom-ctrl");
      assert.equal(custom.commands[0].agent, "custom-ctrl");

      // builtin domains still present
      const ids = domains.map((d) => d.id);
      assert.ok(ids.includes("coding"));
      assert.ok(ids.includes("ralph"));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ─── 自动扫描 .opencode/domains/*.json（README §"添加新领域"承诺的能力）───

  it("auto-scans .opencode/domains/ when cwd is provided", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "loop-md-cli-scan-test-"));
    try {
      const domainsDir = join(tmpDir, DOMAINS_DIR);
      mkdirSync(domainsDir, { recursive: true });
      writeFileSync(
        join(domainsDir, "foo.json"),
        JSON.stringify({
          id: "foo",
          engine: { type: "loop" },
          agents: [
            { role: "orchestrator", name: "foo-orch", description: "Foo orchestrator" },
          ],
          commands: [
            { kind: "entry", agent: "foo-orch", name: "foo-loop", description: "Foo loop" },
          ],
        }),
      );

      const domains = resolveDomains([], tmpDir);
      const foo = findDomain(domains, "foo");
      assert.equal(foo.id, "foo");
      assert.equal(foo.agents[0].name, "foo-orch");

      // 内置领域仍在
      const ids = domains.map((d) => d.id);
      assert.ok(ids.includes("coding"), "builtins should still be present");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("merges auto-scanned domains with explicit --domain-file (explicit wins by id)", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "loop-md-cli-merge-test-"));
    try {
      const domainsDir = join(tmpDir, DOMAINS_DIR);
      mkdirSync(domainsDir, { recursive: true });
      writeFileSync(
        join(domainsDir, "scanned.json"),
        JSON.stringify({
          id: "scanned",
          engine: { type: "loop" },
          agents: [{ role: "orchestrator", name: "scanned-orch", description: "from scan" }],
          commands: [{ kind: "entry", agent: "scanned-orch", name: "scanned-loop", description: "x" }],
        }),
      );

      // 同时用 --domain-file 传入另一个不冲突的领域
      const extraFile = join(tmpDir, "explicit.json");
      writeFileSync(
        extraFile,
        JSON.stringify({
          id: "explicit",
          engine: { type: "loop" },
          agents: [{ role: "orchestrator", name: "explicit-orch", description: "from CLI" }],
          commands: [{ kind: "entry", agent: "explicit-orch", name: "explicit-loop", description: "y" }],
        }),
      );

      const domains = resolveDomains([extraFile], tmpDir);
      const ids = domains.map((d) => d.id);
      assert.ok(ids.includes("scanned"), "auto-scanned domain should be present");
      assert.ok(ids.includes("explicit"), "explicit domain should be present");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("skips invalid JSON in domains dir without throwing (warns on stderr)", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "loop-md-cli-bad-test-"));
    try {
      const domainsDir = join(tmpDir, DOMAINS_DIR);
      mkdirSync(domainsDir, { recursive: true });
      // 一个坏文件
      writeFileSync(join(domainsDir, "bad.json"), "{ not valid json");
      // 一个好文件
      writeFileSync(
        join(domainsDir, "good.json"),
        JSON.stringify({
          id: "good",
          engine: { type: "loop" },
          agents: [{ role: "orchestrator", name: "good-orch", description: "ok" }],
          commands: [{ kind: "entry", agent: "good-orch", name: "good-loop", description: "ok" }],
        }),
      );

      // 不应抛
      const domains = resolveDomains([], tmpDir);
      const ids = domains.map((d) => d.id);
      assert.ok(ids.includes("good"), "valid file should still load");
      assert.ok(!ids.includes("bad"), "invalid file should be skipped");
      assert.ok(ids.includes("coding"), "builtins still present");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
