import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { generatePlatform } from "../generate.js";
import { PLATFORMS } from "../platforms.js";

/** 每个测试在独立临时目录运行，彻底隔离。 */
describe("generatePlatform integration", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), "loop-md-cli-gen-test-"));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  function listFiles(dir: string): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).sort();
  }

  function readFile(relPath: string): string {
    return readFileSync(relPath, "utf-8");
  }

  // ─── Test: invalid platform throws ───

  it("throws on unknown platform", () => {
    assert.throws(() => generatePlatform("nonexistent-platform"), /未知平台/);
  });

  // ─── Test: 无 --domain 时回退到 ralph（最通用的内核范式）───

  it("no domain falls back to ralph (named family)", () => {
    const result = generatePlatform("claude");

    assert.equal(result.agents, 3, "expected 3 agents");
    assert.equal(result.commands, 1, "expected 1 command");

    const agentFiles = listFiles(join(process.cwd(), ".claude/agents"));
    assert.deepEqual(
      agentFiles,
      ["ralph-orchestrator.md", "ralph-reviewer.md", "ralph-worker.md"],
      "no-domain should fall back to ralph-* agent files",
    );

    const commandFiles = listFiles(join(process.cwd(), ".claude/commands"));
    assert.deepEqual(commandFiles, ["ralph-loop.md"], "no-domain should fall back to ralph-loop command");

    const agentContent = readFile(".claude/agents/ralph-orchestrator.md");
    assert.ok(agentContent.startsWith("---"), "agent file should start with frontmatter delimiter");
    assert.ok(agentContent.includes("name: ralph-orchestrator"), "should contain name: ralph-orchestrator");
    assert.ok(agentContent.includes("description:"), "should contain description");
  });

  it("no domain falls back to ralph (mode family, opencode)", () => {
    const result = generatePlatform("opencode");

    assert.equal(result.agents, 3, "expected 3 agents");
    assert.equal(result.commands, 1, "expected 1 command");

    const agentFiles = listFiles(join(process.cwd(), ".opencode/agents"));
    assert.deepEqual(agentFiles, ["ralph-orchestrator.md", "ralph-reviewer.md", "ralph-worker.md"]);

    const commandFiles = listFiles(join(process.cwd(), ".opencode/commands"));
    assert.deepEqual(commandFiles, ["ralph-loop.md"]);

    const agentContent = readFile(".opencode/agents/ralph-orchestrator.md");
    assert.ok(agentContent.startsWith("---"), "agent file should start with frontmatter delimiter");
    assert.ok(agentContent.includes("description:"), "mode family should have description");
    assert.ok(agentContent.includes("mode: subagent"), "should have mode field");
    assert.ok(agentContent.includes("temperature: 0.3"), "should have temperature field");
  });

  // ─── Test: codebuddy family generates correct files ───

  it("codebuddy family adds model:inherit and permissionMode", () => {
    // 默认（无 domain）回退 ralph → executor 名 = ralph-worker → permissionMode: acceptEdits
    const result = generatePlatform("codebuddy");

    assert.equal(result.agents, 3, "expected 3 agents");
    assert.equal(result.commands, 1, "expected 1 command");

    const workerContent = readFile(".codebuddy/agents/ralph-worker.md");
    assert.ok(workerContent.includes("model: inherit"), "should have model: inherit");
    assert.ok(
      workerContent.includes("permissionMode: acceptEdits"),
      "ralph-worker should have permissionMode: acceptEdits",
    );

    // With domain "coding", executor name becomes "coding-builder" → permissionMode: acceptEdits
    generatePlatform("codebuddy", false, ".opencode/templates", "coding");
    const builderContent = readFile(".codebuddy/agents/coding-builder.md");
    assert.ok(builderContent.includes("permissionMode: acceptEdits"), "coding-builder should have permissionMode: acceptEdits");
    assert.ok(builderContent.includes("model: inherit"), "coding-builder should have model: inherit");

    const orchestratorContent = readFile(".codebuddy/agents/coding-orchestrator.md");
    assert.ok(orchestratorContent.includes("permissionMode: default"), "coding-orchestrator should have permissionMode: default");
  });

  // ─── Test: trae family generates correct files ───

  it("trae family generates agents and commands with trae-style frontmatter", () => {
    const result = generatePlatform("trae");

    assert.equal(result.agents, 3, "expected 3 agents");
    assert.equal(result.commands, 1, "expected 1 command");

    const agentFiles = listFiles(join(process.cwd(), ".trae/agents"));
    assert.deepEqual(agentFiles, ["ralph-orchestrator.md", "ralph-reviewer.md", "ralph-worker.md"]);

    // Trae command should have name field
    const commandContent = readFile(".trae/commands/ralph-loop.md");
    assert.ok(commandContent.includes("name: ralph-loop"), "trae command should have name field");
  });

  // ─── Test: dry-run mode does not write files ───

  it("dry-run mode does not write any files", () => {
    // tmp dir is already clean, just verify dry-run behavior
    const claudeBase = join(process.cwd(), ".claude");

    const result = generatePlatform("claude", true /* dryRun */);

    assert.equal(result.agents, 3, "dry-run should still return agent count");
    assert.equal(result.commands, 1, "dry-run should still return command count");

    // dry-run creates the directory structure but writes no files
    assert.ok(existsSync(join(claudeBase, "agents")), "agents dir should exist (mkdir is unconditional)");
    assert.ok(existsSync(join(claudeBase, "commands")), "commands dir should exist (mkdir is unconditional)");

    // But no actual .md files should be written
    const agentFiles = listFiles(join(claudeBase, "agents"));
    const commandFiles = listFiles(join(claudeBase, "commands"));
    assert.deepEqual(agentFiles, [], "no agent files should be written in dry-run");
    assert.deepEqual(commandFiles, [], "no command files should be written in dry-run");
  });

  // ─── Test: domain mode generates domain-specific names ───

  it("domain mode generates agents with domain-specific names (coding)", () => {
    const result = generatePlatform("claude", false, ".opencode/templates", "coding");

    assert.equal(result.agents, 3, "expected 3 agents for coding domain");
    assert.equal(result.commands, 1, "expected 1 command for coding domain");

    const agentFiles = listFiles(join(process.cwd(), ".claude/agents"));
    assert.deepEqual(agentFiles, ["coding-builder.md", "coding-orchestrator.md", "coding-reviewer.md"]);

    const commandFiles = listFiles(join(process.cwd(), ".claude/commands"));
    assert.deepEqual(commandFiles, ["coding-loop.md"]);

    const orchestratorContent = readFile(".claude/agents/coding-orchestrator.md");
    assert.ok(orchestratorContent.includes("name: coding-orchestrator"), "should use domain-specific name");
    assert.ok(
      orchestratorContent.includes("Coding-Loop 主控 Agent"),
      "should use domain-specific description",
    );
  });

  it("domain mode generates test domain correctly", () => {
    const result = generatePlatform("opencode", false, ".opencode/templates", "testing");

    assert.equal(result.agents, 3, "expected 3 agents for testing domain");
    assert.equal(result.commands, 1, "expected 1 command for testing domain");

    const agentFiles = listFiles(join(process.cwd(), ".opencode/agents"));
    assert.deepEqual(agentFiles, ["coverage-reviewer.md", "test-orchestrator.md", "test-writer.md"]);

    const commandFiles = listFiles(join(process.cwd(), ".opencode/commands"));
    assert.deepEqual(commandFiles, ["test-loop.md"]);
  });

  // ─── Test: custom domain file ───

  it("custom domain file from writing domain", () => {
    const result = generatePlatform("claude", false, ".opencode/templates", "writing");

    assert.equal(result.agents, 3, "expected 3 agents from writing domain");
    assert.equal(result.commands, 1, "expected 1 command from writing domain");

    const agentFiles = listFiles(join(process.cwd(), ".claude/agents"));
    assert.deepEqual(agentFiles, ["writing-author.md", "writing-orchestrator.md", "writing-reviewer.md"]);
  });

  // ─── Test: custom user templates override package templates ───
  // 用户模板覆盖机制：放 .opencode/templates/agents/<domain>-<role>.md 即可覆盖内置

  it("user templates override package templates", () => {
    const userTemplatesDir = join(process.cwd(), "custom-templates");
    const agentsDir = join(userTemplatesDir, "agents");
    const commandsDir = join(userTemplatesDir, "commands");

    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(commandsDir, { recursive: true });

    // 写自定义 ralph-* 模板（无 domain 时默认走 ralph，所以覆盖 ralph-* 即可影响默认路径）
    for (const role of ["orchestrator", "executor", "reviewer"]) {
      writeFileSync(
        join(agentsDir, `ralph-${role}.md`),
        [
          "---",
          "name: {{name}}",
          "description: {{description}}",
          "---",
          "",
          "# Custom {{name}} Agent",
          "MARKER:user-template-override",
        ].join("\n"),
        "utf-8",
      );
    }

    // Write a minimal ralph-loop command template
    writeFileSync(
      join(commandsDir, "ralph-loop.md"),
      [
        "---",
        "description: {{description}}",
        "---",
        "",
        "# Custom Ralph Loop",
      ].join("\n"),
      "utf-8",
    );

    const result = generatePlatform("claude", false, "custom-templates");

    assert.equal(result.agents, 3, "expected 3 agents with custom templates");

    const content = readFile(".claude/agents/ralph-orchestrator.md");
    assert.ok(content.includes("MARKER:user-template-override"), "should use user template override in body");
    assert.ok(content.includes("# Custom ralph-orchestrator Agent"), "should use custom body content");
  });

  // ─── Test: all families produce valid frontmatter ───

  it("all platform families produce files starting with ---", () => {
    const families = Object.keys(PLATFORMS);

    for (const platformKey of families) {
      generatePlatform(platformKey);

      const dir = PLATFORMS[platformKey].dir;
      const baseDir = join(process.cwd(), dir);

      const agentFiles = listFiles(join(baseDir, "agents"));
      for (const file of agentFiles) {
        const content = readFile(join(baseDir, "agents", file));
        assert.ok(content.startsWith("---"), `${platformKey}/${file} should start with ---`);
      }

      const commandFiles = listFiles(join(baseDir, "commands"));
      for (const file of commandFiles) {
        const content = readFile(join(baseDir, "commands", file));
        assert.ok(content.startsWith("---"), `${platformKey}/${file} should start with ---`);
      }
    }
  });

  // ─── Test: named family (qoder) also works ───

  it("qoder platform generates correctly", () => {
    const result = generatePlatform("qoder");

    assert.equal(result.agents, 3);
    assert.equal(result.commands, 1);

    const commandFiles = listFiles(join(process.cwd(), ".qoder/commands"));
    assert.deepEqual(commandFiles, ["ralph-loop.md"]);
  });

  // ─── Test: kilo platform generates correctly ───

  it("kilo platform generates correctly", () => {
    const result = generatePlatform("kilo");

    assert.equal(result.agents, 3);
    assert.equal(result.commands, 1);

    const agentFiles = listFiles(join(process.cwd(), ".kilo/agents"));
    assert.deepEqual(agentFiles, ["ralph-orchestrator.md", "ralph-reviewer.md", "ralph-worker.md"]);
  });

  // ─── Test: agent files contain body content from templates ───

  it("generated agent files contain markdown body content (ralph default)", () => {
    generatePlatform("claude");

    const content = readFile(".claude/agents/ralph-orchestrator.md");
    assert.ok(content.includes("## 角色"), "should contain role section heading");
    assert.ok(content.includes("Ralph Loop 主控 Agent"), "should contain ralph description text");
  });

  // ─── Test: command files contain markdown body content ───

  it("generated command files contain markdown body content (ralph default)", () => {
    generatePlatform("opencode");

    const content = readFile(".opencode/commands/ralph-loop.md");
    assert.ok(content.includes("# Ralph Loop"), "should contain ralph loop heading");
  });

  // ─── Test: output directory structure ───

  it("creates both agents and commands subdirectories", () => {
    generatePlatform("qoder");

    const baseDir = join(process.cwd(), ".qoder");
    const agentFiles = listFiles(join(baseDir, "agents"));
    const commandFiles = listFiles(join(baseDir, "commands"));

    assert.ok(agentFiles.length > 0, "should have agent files");
    assert.ok(commandFiles.length > 0, "should have command files");
  });

  // ─── Test: domain-specific command names ───

  it("coding domain generates coding-loop command", () => {
    generatePlatform("opencode", false, ".opencode/templates", "coding");

    const commandFiles = listFiles(join(process.cwd(), ".opencode/commands"));
    assert.ok(commandFiles.includes("coding-loop.md"), "should have coding-loop command");
  });

  it("testing domain generates test-loop command", () => {
    generatePlatform("opencode", false, ".opencode/templates", "testing");

    const commandFiles = listFiles(join(process.cwd(), ".opencode/commands"));
    assert.ok(commandFiles.includes("test-loop.md"), "should have test-loop command");
  });

  // ─── Test: domain-specific descriptions in output ───

  it("coding domain agents have domain-specific descriptions", () => {
    generatePlatform("claude", false, ".opencode/templates", "coding");

    const content = readFile(".claude/agents/coding-builder.md");
    assert.ok(content.includes("受控编码与修复的 Builder Agent"), "should have coding domain description");
  });

  it("testing domain agents have domain-specific descriptions", () => {
    generatePlatform("claude", false, ".opencode/templates", "testing");

    const content = readFile(".claude/agents/test-writer.md");
    assert.ok(content.includes("Test-Loop 中唯一可以编写测试代码"), "should have testing domain description");
  });

  // ─── Test: coding/testing/writing 模板正文 enforce 各自纪律 ───

  it("coding template enforces root-cause grouping + scope drift ban", () => {
    generatePlatform("claude", false, ".opencode/templates", "coding");

    const orc = readFile(".claude/agents/coding-orchestrator.md");
    assert.ok(orc.includes("根因分组"), "coding orchestrator must enforce root-cause grouping");
    assert.ok(orc.includes("scope drift"), "coding orchestrator must mention scope drift");

    const exec = readFile(".claude/agents/coding-builder.md");
    assert.ok(exec.includes("根因分组"), "coding executor must mention root-cause grouping");
    assert.ok(exec.includes("forbidden_scope"), "coding executor must enforce forbidden_scope");
  });

  it("testing template enforces source-freeze + coverage/mutation/empty-assertion", () => {
    generatePlatform("claude", false, ".opencode/templates", "testing");

    const orc = readFile(".claude/agents/test-orchestrator.md");
    assert.ok(orc.includes("源码冻结"), "testing orchestrator must enforce source freeze");
    assert.ok(orc.includes("coverage.lines"), "testing orchestrator must reference coverage threshold");
    assert.ok(orc.includes("mutation_score"), "testing orchestrator must reference mutation score");
    assert.ok(orc.includes("empty_assertions_count"), "testing orchestrator must reference empty-assertion count");

    const exec = readFile(".claude/agents/test-writer.md");
    assert.ok(exec.includes("源码冻结"), "testing executor must mention source freeze as first rule");
    assert.ok(exec.includes("源码冻结") && exec.includes("唯一可以编写测试代码"), "testing executor must reinforce writer-only role");
  });

  it("writing template enforces terminology/links/code-example signals", () => {
    generatePlatform("claude", false, ".opencode/templates", "writing");

    const orc = readFile(".claude/agents/writing-orchestrator.md");
    assert.ok(orc.includes("terminology_drift_count"), "writing orchestrator must reference terminology drift");
    assert.ok(orc.includes("broken_links_count"), "writing orchestrator must reference broken links");
    assert.ok(orc.includes("code_example_errors"), "writing orchestrator must reference code example errors");
    // writing 不应包含 SE 偏向
    assert.ok(!orc.includes("detected_stack"), "writing orchestrator must NOT reference SE-specific detected_stack");
    assert.ok(!orc.includes("scripts_gap"), "writing orchestrator must NOT reference scripts_gap");
  });

  // ─── Test: backpressure 通用化（所有领域都带断路器）───

  it("coding domain orchestrator includes backpressure circuit breaker", () => {
    generatePlatform("claude", false, ".opencode/templates", "coding");

    const content = readFile(".claude/agents/coding-orchestrator.md");
    assert.ok(content.includes("## 背压（断路器）"), "coding orchestrator should have backpressure section");
    assert.ok(content.includes("验证命令：`npm test`"), "should use npm test as verification command");
  });

  it("writing domain uses lint weak-gate backpressure", () => {
    generatePlatform("claude", false, ".opencode/templates", "writing");

    const content = readFile(".claude/agents/writing-orchestrator.md");
    assert.ok(content.includes("验证命令：`npm run lint`"), "writing should use lint gate");
    assert.ok(content.includes("最大失败次数：2"), "writing should allow 2 failures");
  });

  it("non-orchestrator roles do not get backpressure section", () => {
    generatePlatform("claude", false, ".opencode/templates", "coding");

    const builder = readFile(".claude/agents/coding-builder.md");
    assert.ok(!builder.includes("## 背压"), "executor should not have backpressure section");
    const reviewer = readFile(".claude/agents/coding-reviewer.md");
    assert.ok(!reviewer.includes("## 背压"), "reviewer should not have backpressure section");
  });

  // ─── Test: ralph 领域使用专属模板（任务列表 + 背压熔断范式）───

  it("ralph domain uses dedicated ralph-orchestrator template with TaskList workflow", () => {
    generatePlatform("claude", false, ".opencode/templates", "ralph");

    const content = readFile(".claude/agents/ralph-orchestrator.md");
    // ralph 专属范式：任务列表驱动
    assert.ok(content.includes("TaskList"), "ralph-orchestrator should be task-list driven");
    assert.ok(content.includes("背压熔断"), "ralph-orchestrator should mention backpressure circuit breaker");
    assert.ok(content.includes("consecutive_failures"), "ralph should track failure count");
    // 不应包含 coding 范式的 scope/baseline 概念
    assert.ok(!content.includes("hard_scope"), "ralph should NOT use coding scope model");
    assert.ok(!content.includes("声明边界"), "ralph should NOT use coding boundary model");
    assert.ok(!content.includes("Baseline"), "ralph should NOT use coding baseline model");
  });

  it("ralph domain executor template differs from coding executor", () => {
    generatePlatform("claude", false, ".opencode/templates", "ralph");

    const content = readFile(".claude/agents/ralph-worker.md");
    assert.ok(content.includes("验证命令"), "ralph executor should mention verification command");
    assert.ok(content.includes("verification"), "ralph executor should output verification field");
    assert.ok(!content.includes("forbidden_scope"), "ralph executor should NOT reference forbidden_scope");
  });

  it("ralph domain command uses dedicated ralph-loop template", () => {
    generatePlatform("claude", false, ".opencode/templates", "ralph");

    const content = readFile(".claude/commands/ralph-loop.md");
    assert.ok(content.includes("Ralph Orchestrator"), "ralph-loop command should reference Ralph Orchestrator");
    assert.ok(content.includes("背压熔断"), "ralph-loop should describe circuit breaker workflow");
    assert.ok(content.includes("max_failures"), "ralph-loop should reference max_failures threshold");
  });

  it("ralph orchestrator places backpressure prominently (before input section)", () => {
    generatePlatform("claude", false, ".opencode/templates", "ralph");

    const content = readFile(".claude/agents/ralph-orchestrator.md");
    const bpIdx = content.indexOf("## 背压（断路器）");
    const inputIdx = content.indexOf("## 输入");
    assert.ok(bpIdx > -1 && inputIdx > -1, "both sections must exist");
    assert.ok(bpIdx < inputIdx, "backpressure should appear before input section (prominent placement)");
  });

  // ─── Test: L3 — command {{agent}} comes from command.agent (no suffix derivation) ───

  it("domain command's {{agent}} placeholder binds to command.agent (L3)", () => {
    // testing domain: command "test-loop" should bind to "test-orchestrator" (via command.agent)
    generatePlatform("opencode", false, ".opencode/templates", "testing");

    const content = readFile(".opencode/commands/test-loop.md");
    assert.ok(
      content.includes("agent: test-orchestrator"),
      "command should bind to its declared agent, not derive from name",
    );
  });

  it("ralph command binds via command.agent not by -loop suffix derivation", () => {
    // ralph 领域：command = "ralph-loop", command.agent = "ralph-orchestrator"
    generatePlatform("opencode", false, ".opencode/templates", "ralph");

    const content = readFile(".opencode/commands/ralph-loop.md");
    assert.ok(content.includes("agent: ralph-orchestrator"), "should bind to ralph-orchestrator via command.agent");
  });

  it("default (no domain) command falls back to ralph-loop binding ralph-orchestrator", () => {
    // 无 domain 时：默认走 ralph，command = "ralph-loop"，command.agent = "ralph-orchestrator"
    generatePlatform("opencode", false, ".opencode/templates");

    const content = readFile(".opencode/commands/ralph-loop.md");
    assert.ok(
      content.includes("agent: ralph-orchestrator"),
      "no-domain should fall back to ralph, binding ralph-orchestrator",
    );
  });

  // ─── 缺陷 1 回归：reviewer 角色（任意领域名）必须拿到只读工具白名单 ───

  it("default (no domain) reviewer gets read-only tools via ralph fallback (named family)", () => {
    generatePlatform("claude", false, ".opencode/templates");

    const content = readFile(".claude/agents/ralph-reviewer.md");
    assert.ok(
      content.includes("tools: Read, Grep, Glob, Bash"),
      "no-domain reviewer (ralph fallback) should still be read-only",
    );
  });

  it("writing domain reviewer gets read-only tools (named family)", () => {
    generatePlatform("claude", false, ".opencode/templates", "writing");

    const content = readFile(".claude/agents/writing-reviewer.md");
    assert.ok(
      content.includes("tools: Read, Grep, Glob, Bash"),
      "writing-reviewer must have read-only tools",
    );
  });

  it("ralph domain reviewer gets read-only tools on trae (PascalCase, no Bash)", () => {
    generatePlatform("trae", false, ".opencode/templates", "ralph");

    const content = readFile(".trae/agents/ralph-reviewer.md");
    assert.ok(
      content.includes("tools: Read, Grep, Glob"),
      "ralph-reviewer on trae should get PascalCase read-only tools",
    );
    assert.ok(!content.includes("Bash"), "ralph-reviewer on trae must NOT have Bash");
  });

  it("writing domain reviewer gets plan permissionMode on codebuddy", () => {
    generatePlatform("codebuddy", false, ".opencode/templates", "writing");

    const content = readFile(".codebuddy/agents/writing-reviewer.md");
    assert.ok(
      content.includes("permissionMode: plan"),
      "writing-reviewer on codebuddy must get plan mode",
    );
    assert.ok(
      content.includes("tools: Read, Grep, Glob, Bash"),
      "writing-reviewer on codebuddy must have read-only tools",
    );
  });

  // ─── 缺陷 3 回归：incremental 切换领域时必须清理孤儿文件 ───
  // ralph → coding 切换后，ralph-*.md 必须被清理

  it("incremental mode prunes orphan files when switching domains", () => {
    // 第一轮：用 ralph 领域 incremental 生成
    generatePlatform("claude", false, ".opencode/templates", "ralph", [], true);
    const afterRalph = listFiles(join(process.cwd(), ".claude/agents"));
    assert.deepEqual(
      afterRalph,
      ["ralph-orchestrator.md", "ralph-reviewer.md", "ralph-worker.md"],
      "ralph domain should produce 3 ralph-* agents",
    );

    // 第二轮：切到 coding 领域 incremental 生成
    generatePlatform("claude", false, ".opencode/templates", "coding", [], true);
    const afterCoding = listFiles(join(process.cwd(), ".claude/agents"));
    assert.deepEqual(
      afterCoding,
      ["coding-builder.md", "coding-orchestrator.md", "coding-reviewer.md"],
      "switching ralph → coding must prune ralph-* orphans",
    );
  });
});
