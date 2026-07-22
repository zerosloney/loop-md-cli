import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NamedRenderer } from "../render/named.js";
import { ModeRenderer } from "../render/mode.js";
import { CodeBuddyRenderer } from "../render/codebuddy.js";
import { TraeRenderer } from "../render/trae.js";
import { QwenRenderer } from "../render/qwen.js";

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

  it("NamedRenderer outputs model when specified", () => {
    const r = new NamedRenderer();
    const modelSrc = {
      ...src,
      name: "coding-orchestrator",
      model: "gpt-5.1-codex",
    };
    const out = r.renderAgent(modelSrc, platform);
    assert.ok(out.includes("model: gpt-5.1-codex"), "named renderer should output model");
  });

  it("NamedRenderer omits model when not specified", () => {
    const r = new NamedRenderer();
    const out = r.renderAgent(src, platform);
    assert.ok(!out.includes("model:"), "named renderer should not output model when absent");
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
      if (/^ {2}[A-Za-z]/.test(l) && !/^ {3}/.test(l)) {
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

  it("ModeRenderer outputs model when specified", () => {
    const r = new ModeRenderer();
    const modelSrc = {
      ...src,
      name: "coding-orchestrator",
      model: "anthropic/claude-sonnet-4-20250514",
    };
    const out = r.renderAgent(modelSrc, platform);
    assert.ok(
      out.includes("model: anthropic/claude-sonnet-4-20250514"),
      "mode renderer should output model",
    );
  });

  it("ModeRenderer omits model when not specified", () => {
    const r = new ModeRenderer();
    const out = r.renderAgent(src, platform);
    assert.ok(!out.includes("model:"), "mode renderer should not output model when absent");
  });

  it("CodeBuddyRenderer adds model inherit and permissionMode", () => {
    const r = new CodeBuddyRenderer();
    const reviewerSrc = { ...src, name: "code-reviewer" };
    const out = r.renderAgent(reviewerSrc, platform);
    assert.ok(out.includes("model: inherit"));
    assert.ok(out.includes("permissionMode: plan"));
  });

  it("CodeBuddyRenderer outputs custom model when specified", () => {
    const r = new CodeBuddyRenderer();
    const modelSrc = {
      ...src,
      name: "coding-orchestrator",
      model: "gpt-5.1-codex",
    };
    const out = r.renderAgent(modelSrc, platform);
    assert.ok(out.includes("model: gpt-5.1-codex"), "codebuddy should output custom model alias");
    assert.ok(
      !out.includes("model: inherit"),
      "should not output inherit when custom model is set",
    );
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
    assert.ok(
      out.includes("tools: Read, Grep, Glob, Bash"),
      "reviewer role should get read-only tools",
    );
  });

  it("CodeBuddyRenderer restricts reviewer tools and permissionMode by role", () => {
    const r = new CodeBuddyRenderer();
    const reviewerSrc = {
      ...src,
      name: "ralph-reviewer",
      role: "reviewer",
    };
    const out = r.renderAgent(reviewerSrc, platform);
    assert.ok(
      out.includes("tools: Read, Grep, Glob, Bash"),
      "reviewer role should get read-only tools",
    );
    assert.ok(out.includes("permissionMode: plan"), "reviewer role should get plan mode");
  });

  it("TraeRenderer restricts reviewer tools by role (PascalCase, no Bash)", () => {
    const r = new TraeRenderer();
    const reviewerSrc = {
      ...src,
      name: "writing-reviewer",
      role: "reviewer",
    };
    const out = r.renderAgent(reviewerSrc, platform);
    assert.ok(
      out.includes("tools: Read, Grep, Glob"),
      "trae reviewer should get PascalCase read-only tools",
    );
    assert.ok(!out.includes("Bash"), "trae reviewer must NOT have Bash (read-only contract)");
  });

  it("TraeRenderer outputs model when specified", () => {
    const r = new TraeRenderer();
    const modelSrc = {
      ...src,
      name: "coding-orchestrator",
      model: "DeepSeek-V4-Pro",
    };
    const out = r.renderAgent(modelSrc, platform);
    assert.ok(out.includes("model: DeepSeek-V4-Pro"), "trae should output model field");
  });

  it("TraeRenderer omits model when not specified", () => {
    const r = new TraeRenderer();
    const out = r.renderAgent(src, platform);
    assert.ok(!out.includes("model:"), "trae should not output model field when absent");
  });

  it("QwenRenderer outputs name, description, and approvalMode for orchestrator", () => {
    const r = new QwenRenderer();
    const out = r.renderAgent(src, platform);
    assert.ok(out.includes("name: code-builder"));
    assert.ok(out.includes("description: Builder agent"));
    assert.ok(
      out.includes("approvalMode: auto-edit"),
      "orchestrator/executor should get auto-edit",
    );
  });

  it("QwenRenderer outputs model when specified", () => {
    const r = new QwenRenderer();
    const modelSrc = { ...src, name: "coding-orchestrator", model: "qwen3-coder" };
    const out = r.renderAgent(modelSrc, platform);
    assert.ok(out.includes("model: qwen3-coder"), "qwen should output model field");
  });

  it("QwenRenderer omits model when not specified", () => {
    const r = new QwenRenderer();
    const out = r.renderAgent(src, platform);
    assert.ok(!out.includes("model:"), "qwen should not output model when absent");
  });

  it("QwenRenderer restricts reviewer with tools + disallowedTools + approvalMode plan", () => {
    const r = new QwenRenderer();
    const reviewerSrc = { ...src, name: "ralph-reviewer", role: "reviewer" };
    const out = r.renderAgent(reviewerSrc, platform);
    assert.ok(out.includes("tools: Read, Grep, Glob, Bash"), "reviewer should get read-only tools");
    assert.ok(
      out.includes("disallowedTools: [Write, Edit]"),
      "reviewer should have disallowed Write/Edit",
    );
    assert.ok(out.includes("approvalMode: plan"), "reviewer should get plan mode");
  });

  // ─── YAML 转义回归：自由文本含特殊字符时必须加引号，避免生成非法 frontmatter ───

  it("escapes description containing ': ' so output stays valid YAML", () => {
    const r = new NamedRenderer();
    const out = r.renderAgent({ ...src, description: "Agent: the best builder" }, platform);
    assert.ok(
      out.includes('description: "Agent: the best builder"'),
      "colon-space description must be quoted",
    );
  });

  it("escapes description containing ' #' so it is not parsed as a comment", () => {
    const r = new NamedRenderer();
    const out = r.renderAgent({ ...src, description: "Builds stuff # fast" }, platform);
    assert.ok(
      out.includes('description: "Builds stuff # fast"'),
      "hash description must be quoted",
    );
  });

  it("does not over-quote model with colon-but-no-space (valid plain scalar)", () => {
    const r = new NamedRenderer();
    // openai:gpt-4 的冒号后无空格，是合法 plain scalar，不应加引号
    const out = r.renderAgent(
      { ...src, name: "coding-orchestrator", model: "openai:gpt-4" },
      platform,
    );
    assert.ok(out.includes("model: openai:gpt-4"), "colon-without-space model must stay unquoted");
  });

  it("escapes model containing ': ' (colon followed by space)", () => {
    const r = new NamedRenderer();
    const out = r.renderAgent(
      { ...src, name: "coding-orchestrator", model: "provider: model-x" },
      platform,
    );
    assert.ok(out.includes('model: "provider: model-x"'), "colon-space model must be quoted");
  });

  it("escapes inner double quotes when quoting", () => {
    const r = new NamedRenderer();
    const out = r.renderAgent({ ...src, description: 'Says "hi": loudly' }, platform);
    assert.ok(out.includes('description: "Says \\"hi\\": loudly"'), "inner quotes must be escaped");
  });

  it("leaves safe values unquoted (no output change for existing templates)", () => {
    const r = new NamedRenderer();
    const out = r.renderAgent(src, platform);
    assert.ok(out.includes("name: code-builder"), "safe name stays unquoted");
    assert.ok(out.includes("description: Builder agent"), "safe description stays unquoted");
  });

  it("does not quote role-indexed constants (tools / disallowedTools flow sequence)", () => {
    const r = new QwenRenderer();
    const out = r.renderAgent({ ...src, name: "ralph-reviewer", role: "reviewer" }, platform);
    // disallowedTools 是 YAML flow sequence，绝不能被加引号成字符串
    assert.ok(out.includes("disallowedTools: [Write, Edit]"), "flow sequence must stay unquoted");
    assert.ok(out.includes("tools: Read, Grep, Glob, Bash"), "tools list must stay unquoted");
  });
});
