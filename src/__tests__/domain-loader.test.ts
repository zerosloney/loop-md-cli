import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveDomains, findDomain } from "../domain-loader.js";

describe("domain-loader", () => {
  it("includes builtin domains by default", () => {
    const domains = resolveDomains();
    const ids = domains.map((d) => d.id);
    assert.ok(ids.includes("programming"));
    assert.ok(ids.includes("testing"));
  });

  it("finds builtin domain by id", () => {
    const domains = resolveDomains();
    const d = findDomain(domains, "programming");
    assert.equal(d.id, "programming");
    assert.ok(d.agents.some((a) => a.role === "orchestrator"));
    assert.ok(d.commands.some((c) => c.role === "loop"));
  });

  it("throws on unknown domain", () => {
    const domains = resolveDomains();
    assert.throws(() => findDomain(domains, "nonexistent"), /未知领域/);
  });

  it("merges project domain files", () => {
    const domains = resolveDomains();
    const writing = findDomain(domains, "writing");
    assert.equal(writing.id, "writing");
    assert.ok(writing.agents.some((a) => a.name === "writing-orchestrator"));
    assert.ok(writing.commands.some((c) => c.name === "writing-loop"));
  });

  it("merges extra CLI domain files with override", () => {
    const domains = resolveDomains(["src/domains/writing.json"]);
    const writing = findDomain(domains, "writing");
    assert.equal(writing.id, "writing");
  });
});
