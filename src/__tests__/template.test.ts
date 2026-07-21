import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadAgentTemplates, loadCommandTemplates, renderTemplate } from "../template.js";

describe("template", () => {
  it("renders placeholders in agent template", () => {
    const tpl = "name: {{name}}\ndescription: {{description}}\nbody: {{body}}";
    const out = renderTemplate(tpl, { name: "orchestrator", description: "Controller", body: "content" });
    assert.ok(out.includes("name: orchestrator"));
    assert.ok(out.includes("description: Controller"));
    assert.ok(out.includes("body: content"));
  });

  it("renders placeholders in command template with agent", () => {
    const tpl = "agent: {{agent}}\ndescription: {{description}}";
    const out = renderTemplate(tpl, { name: "loop", description: "Loop command", agent: "orchestrator" });
    assert.ok(out.includes("agent: orchestrator"));
  });

  it("loadAgentTemplates returns package templates", () => {
    const agents = loadAgentTemplates();
    assert.ok(Object.keys(agents).length > 0, "expected package agent templates");
    // 内置 4 个领域 + ralph 内核 = 至少 16 个 agent 模板（4 × 3 角色 + ralph 已计入）
    // 至少要有 ralph-orchestrator（最通用的内核范式）
    assert.ok("ralph-orchestrator" in agents, "ralph-orchestrator should exist as universal baseline");
    assert.ok(agents["ralph-orchestrator"].includes("{{name}}"));
    // 三个特化领域都应该有专属模板
    assert.ok("coding-orchestrator" in agents, "coding-orchestrator should exist");
    assert.ok("testing-orchestrator" in agents, "testing-orchestrator should exist");
    assert.ok("writing-orchestrator" in agents, "writing-orchestrator should exist");
  });

  it("loadCommandTemplates returns package command templates", () => {
    const commands = loadCommandTemplates();
    assert.ok(Object.keys(commands).length > 0, "expected package command templates");
    // 4 个领域各自的 command 模板
    assert.ok("ralph-loop" in commands);
    assert.ok(commands["ralph-loop"].includes("{{agent}}"));
    assert.ok("coding-loop" in commands);
    assert.ok("testing-loop" in commands);
    assert.ok("writing-loop" in commands);
  });

  it("leaves unreplaced placeholders untouched", () => {
    const tpl = "name: {{name}}\nmissing: {{missing}}";
    const out = renderTemplate(tpl, { name: "x" });
    assert.ok(out.includes("name: x"));
    assert.ok(out.includes("missing: {{missing}}"));
  });
});
