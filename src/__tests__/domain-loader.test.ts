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
    assert.ok(d.agents.some((a) => a.role === "orchestrator"));
    assert.ok(d.commands.some((c) => c.role === "loop"));
  });

  it("finds writing domain", () => {
    const domains = resolveDomains();
    const writing = findDomain(domains, "writing");
    assert.equal(writing.id, "writing");
    assert.ok(writing.agents.some((a) => a.name === "writing-orchestrator"));
    assert.ok(writing.agents.some((a) => a.name === "writing-author"));
    assert.ok(writing.agents.some((a) => a.name === "writing-reviewer"));
    assert.ok(writing.commands.some((c) => c.name === "writing-loop"));
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
  });

  it("finds ralph domain with backpressure", () => {
    const domains = resolveDomains();
    const ralph = findDomain(domains, "ralph");
    assert.equal(ralph.id, "ralph");
    assert.ok(ralph.agents.some((a) => a.name === "ralph-orchestrator"));
    assert.ok(ralph.agents.some((a) => a.name === "ralph-worker"));
    assert.ok(ralph.agents.some((a) => a.name === "ralph-reviewer"));
    assert.ok(ralph.commands.some((c) => c.name === "ralph-loop"));
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
        agents: [
          { role: "orchestrator", name: "custom-ctrl", description: "Custom orchestrator" },
        ],
        commands: [
          { role: "loop", name: "custom-loop", description: "Custom loop" },
        ],
      }));

      const domains = resolveDomains([extraFile]);
      const custom = findDomain(domains, "custom");
      assert.equal(custom.id, "custom");
      assert.equal(custom.agents[0].name, "custom-ctrl");

      // builtin domains still present
      const ids = domains.map((d) => d.id);
      assert.ok(ids.includes("programming"));
      assert.ok(ids.includes("ralph"));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
