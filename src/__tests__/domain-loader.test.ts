import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

import { resolveDomains, findDomain } from "../domain-loader.js";

describe("domain-loader", () => {
  it("includes all builtin domains by default", () => {
    const domains = resolveDomains();
    const ids = domains.map((d) => d.id);
    assert.ok(ids.includes("programming"));
    assert.ok(ids.includes("testing"));
    assert.ok(ids.includes("writing"));
    assert.ok(ids.includes("ralph"));
  });

  it("finds builtin domain by id", () => {
    const domains = resolveDomains();
    const d = findDomain(domains, "programming");
    assert.equal(d.id, "programming");
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

  it("finds programming domain with backpressure", () => {
    const domains = resolveDomains();
    const programming = findDomain(domains, "programming");
    assert.equal(programming.id, "programming");
    assert.deepEqual(programming.backpressure, {
      type: "test",
      command: "npm test",
      max_failures: 3,
      retry_on_failure: true,
    });
    const codeLoop = programming.commands.find((c) => c.name === "code-loop");
    assert.equal(codeLoop?.agent, "code-orchestrator");
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
    const tmpDir = mkdtempSync(join(tmpdir(), "loop-forge-domain-test-"));
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
      assert.ok(ids.includes("programming"));
      assert.ok(ids.includes("ralph"));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
