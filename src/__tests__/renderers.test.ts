import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NamedRenderer } from "../render/named.js";
import { ModeRenderer } from "../render/mode.js";
import { CodeBuddyRenderer } from "../render/codebuddy.js";
import { TraeRenderer } from "../render/trae.js";

const platform = { id: "test", dir: ".test", family: "named" as const, note: "test" };

describe("renderers", () => {
  const src = {
    name: "code-builder",
    description: "Builder agent",
    frontmatter: { mode: "subagent", permission: "edit: allow\nread: allow" },
    body: "## Role\nYou build.",
  };

  it("NamedRenderer omits empty tools", () => {
    const r = new NamedRenderer();
    const out = r.renderAgent(src, platform);
    assert.ok(!out.includes("tools:"));
  });

  it("ModeRenderer emits block scalar for multi-line values", () => {
    const r = new ModeRenderer();
    const out = r.renderAgent(src, platform);
    assert.ok(out.includes("permission: |"));
    assert.ok(out.includes("  edit: allow"));
    assert.ok(out.includes("  read: allow"));
  });

  it("ModeRenderer keeps scalar fields inline", () => {
    const r = new ModeRenderer();
    const out = r.renderAgent(src, platform);
    assert.ok(out.includes("mode: subagent"));
  });

  it("CodeBuddyRenderer adds model inherit and permissionMode", () => {
    const r = new CodeBuddyRenderer();
    const reviewerSrc = { ...src, name: "code-reviewer" };
    const out = r.renderAgent(reviewerSrc, platform);
    assert.ok(out.includes("model: inherit"));
    assert.ok(out.includes("permissionMode: plan"));
  });

  it("TraeRenderer omits empty tools", () => {
    const r = new TraeRenderer();
    const out = r.renderAgent(src, platform);
    assert.ok(!out.includes("tools:"));
  });
});
