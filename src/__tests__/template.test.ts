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
    assert.ok("orchestrator" in agents);
    assert.ok(agents.orchestrator.includes("{{name}}"));
  });

  it("loadCommandTemplates returns package command templates", () => {
    const commands = loadCommandTemplates();
    assert.ok(Object.keys(commands).length > 0, "expected package command templates");
    assert.ok("loop" in commands);
    assert.ok(commands.loop.includes("{{agent}}"));
  });

  it("leaves unreplaced placeholders untouched", () => {
    const tpl = "name: {{name}}\nmissing: {{missing}}";
    const out = renderTemplate(tpl, { name: "x" });
    assert.ok(out.includes("name: x"));
    assert.ok(out.includes("missing: {{missing}}"));
  });
});
