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

  // ─── 缺陷 1 回归：reviewer 角色按 role 索引工具白名单（不再依赖 agent name） ───
  // 旧实现按 name 索引，导致 writing-reviewer / ralph-reviewer 等非 code-* reviewer 完全无工具限制。
  // 现在按 role 索引，所有 reviewer 都拿到只读白名单。

  it("NamedRenderer restricts reviewer tools by role (covers any domain reviewer name)", () => {
    const r = new NamedRenderer();
    // 故意用 code-* / coverage-* 之外的 reviewer 名字，验证按 role 索引生效
    const reviewerSrc = {
      ...src,
      name: "writing-reviewer",
      role: "reviewer",
    };
    const out = r.renderAgent(reviewerSrc, platform);
    assert.ok(out.includes("tools: Read, Grep, Glob, Bash"), "reviewer role should get read-only tools");
  });

  it("CodeBuddyRenderer restricts reviewer tools and permissionMode by role", () => {
    const r = new CodeBuddyRenderer();
    const reviewerSrc = {
      ...src,
      name: "ralph-reviewer",
      role: "reviewer",
    };
    const out = r.renderAgent(reviewerSrc, platform);
    assert.ok(out.includes("tools: Read, Grep, Glob, Bash"), "reviewer role should get read-only tools");
    assert.ok(out.includes("permissionMode: plan"), "reviewer role should get plan mode");
  });

  it("TraeRenderer restricts reviewer tools by role (uppercase, no Bash)", () => {
    const r = new TraeRenderer();
    const reviewerSrc = {
      ...src,
      name: "writing-reviewer",
      role: "reviewer",
    };
    const out = r.renderAgent(reviewerSrc, platform);
    assert.ok(out.includes("tools: Read, Glob, Grep"), "trae reviewer should get uppercase read-only tools");
    assert.ok(!out.includes("Bash"), "trae reviewer must NOT have Bash (read-only contract)");
  });
});
