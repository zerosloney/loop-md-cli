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

  it("ModeRenderer emits YAML map for multi-line map values (permission)", () => {
    const r = new ModeRenderer();
    const out = r.renderAgent(src, platform);
    // permission 是结构化 map，不用 block scalar (|)；直接以嵌套 map 输出
    assert.ok(!out.includes("permission: |"));
    assert.ok(out.includes("permission:\n"));
    assert.ok(out.includes("  edit: allow"));
    assert.ok(out.includes("  read: allow"));
  });

  it("ModeRenderer permission output parses as nested YAML map (not string)", () => {
    // 回归：OpenCode 按 permission.bash["*"] 访问，必须是 dict 而非字符串。
    // 用真实模板（带 bash 子 map）渲染，朴素 YAML 解析验证嵌套结构。
    const deepSrc = {
      name: "ralph-orchestrator",
      description: "test",
      frontmatter: {
        mode: "subagent",
        permission: 'edit: deny\nbash:\n  "*": deny\n  "test": allow\nread: allow',
      },
      body: "body",
    };
    const out = new ModeRenderer().renderAgent(deepSrc, platform);
    // 朴素 YAML 解析：split 出 frontmatter 块，按缩进重建 map
    const fmBlock = out.split("---\n")[1];
    const lines = fmBlock.split("\n");
    // 找到 permission: 这一行，下面所有更深层缩进行都属于它
    const permIdx = lines.findIndex((l) => l.startsWith("permission:"));
    assert.ok(permIdx >= 0, "permission field exists");
    assert.ok(!lines[permIdx].includes("|"), "not block scalar");
    // permission 的直接子节点（2 空格缩进）应该是 edit / bash / read
    const children: string[] = [];
    for (const l of lines.slice(permIdx + 1)) {
      if (l.trim() === "") continue;
      if (/^  [A-Za-z]/.test(l) && !/^   /.test(l)) {
        children.push(l.trim().split(":")[0]);
      } else if (/^[A-Za-z]/.test(l)) {
        break; // 离开 permission 块
      }
    }
    assert.deepEqual(children.sort(), ["bash", "edit", "read"]);
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

  it("TraeRenderer restricts reviewer tools by role (lowercase, no Bash)", () => {
    const r = new TraeRenderer();
    const reviewerSrc = {
      ...src,
      name: "writing-reviewer",
      role: "reviewer",
    };
    const out = r.renderAgent(reviewerSrc, platform);
    assert.ok(out.includes("tools: read, grep, glob"), "trae reviewer should get lowercase read-only tools");
    assert.ok(!out.includes("Bash"), "trae reviewer must NOT have Bash (read-only contract)");
  });
});
