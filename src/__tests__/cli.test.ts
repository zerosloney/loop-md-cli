import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// 动态读取包版本，避免把版本号硬编码进测试（版本升级时测试自动跟随）
const PKG_VERSION = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8"))
  .version as string;

function runCli(
  args: string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const cliPath = join(__dirname, "..", "cli.js");
    const proc = spawn(process.execPath, [cliPath, ...args], {
      cwd: cwd ?? join(__dirname, ".."),
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    proc.stdout.on("data", (c: Buffer) => stdout.push(c));
    proc.stderr.on("data", (c: Buffer) => stderr.push(c));
    // 超时守卫：避免交互提示等意外导致测试永久挂起
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
    }, 20000);
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdout).toString("utf-8"),
        stderr: Buffer.concat(stderr).toString("utf-8"),
        code: code ?? 1,
      });
    });
  });
}

describe("CLI --help and --version", () => {
  it("--help prints usage and exits 0", async () => {
    const { stdout, stderr, code } = await runCli(["--help"]);
    assert.equal(code, 0, "--help should exit 0");
    assert.equal(stderr, "", "--help should produce no stderr");
    assert.ok(stdout.includes("loop-md-cli"), "should contain program name");
    assert.ok(stdout.includes("--help"), "should mention --help flag");
    assert.ok(stdout.includes("--version"), "should mention --version flag");
    assert.ok(stdout.includes("--all"), "should mention --all flag");
    assert.ok(stdout.includes("--claude"), "should list claude platform");
    assert.ok(stdout.includes("--opencode"), "should list opencode platform");
    assert.ok(stdout.includes("示例"), "should include examples section");
  });

  it("-h is alias for --help", async () => {
    const { stdout, code } = await runCli(["-h"]);
    assert.equal(code, 0);
    assert.ok(stdout.includes("--help"), "-h should show help");
  });

  it("--version prints version and exits 0", async () => {
    const { stdout, stderr, code } = await runCli(["--version"]);
    assert.equal(code, 0);
    assert.equal(stderr, "");
    assert.ok(/^\d+\.\d+\.\d+$/.test(stdout.trim()), "should print semver");
    assert.equal(stdout.trim(), PKG_VERSION, "version should match package.json");
  });

  it("-v is alias for --version", async () => {
    const { stdout, code } = await runCli(["-v"]);
    assert.equal(code, 0);
    assert.ok(/^\d+\.\d+\.\d+$/.test(stdout.trim()));
  });

  it("--version reads from package.json", async () => {
    const { stdout } = await runCli(["--version"]);
    assert.equal(stdout.trim(), PKG_VERSION);
  });

  it("--help output is non-empty and well-structured", async () => {
    const { stdout } = await runCli(["--help"]);
    assert.ok(stdout.includes("用法:"), "should have usage section");
    assert.ok(stdout.includes("选项:"), "should have options section");
    assert.ok(stdout.includes("平台选项"), "should have platforms section");
    assert.ok(stdout.includes("示例:"), "should have examples section");
  });

  it("unknown flag produces error and exits 1", async () => {
    const { stdout, stderr, code } = await runCli(["--unknown-flag"]);
    assert.equal(code, 1);
    const combined = stdout + stderr;
    assert.ok(
      combined.includes("未知选项") || combined.includes("未知参数"),
      "should mention unknown option",
    );
    assert.ok(combined.includes("--help"), "should suggest --help");
  });
});

// ─── 进程级集成测试：覆盖 --dry-run / --validate / --domain / --archive ───
// 旧测试只覆盖 --help/--version/unknown flag；这里在隔离临时目录里跑真实命令链路。

describe("CLI integration (process-level)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "loop-md-cli-cli-it-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("--dry-run --claude exits 0 and writes nothing", async () => {
    const { code } = await runCli(["--dry-run", "--claude"], tmpDir);
    assert.equal(code, 0, "--dry-run should exit 0");
    assert.ok(!existsSync(join(tmpDir, ".claude")), "dry-run must NOT create the output dir");
  });

  it("--claude generates ralph agents into .claude/", async () => {
    const { code } = await runCli(["--claude"], tmpDir);
    assert.equal(code, 0, "--claude should exit 0");
    assert.ok(
      existsSync(join(tmpDir, ".claude", "agents", "ralph-orchestrator.md")),
      "should generate ralph-orchestrator.md",
    );
  });

  it("--claude --domain coding generates coding agents", async () => {
    const { code } = await runCli(["--claude", "--domain", "coding"], tmpDir);
    assert.equal(code, 0, "--domain coding should exit 0");
    assert.ok(
      existsSync(join(tmpDir, ".claude", "agents", "coding-orchestrator.md")),
      "should generate coding-orchestrator.md",
    );
  });

  it("--validate --claude passes after a fresh generation", async () => {
    const gen = await runCli(["--claude"], tmpDir);
    assert.equal(gen.code, 0, "generation should exit 0");

    const { code } = await runCli(["--validate", "--claude"], tmpDir);
    assert.equal(code, 0, "validate should pass right after generation");
  });

  it("--archive out.zip --claude produces a zip in cwd", async () => {
    const { stdout, code } = await runCli(["--archive", "out.zip", "--claude"], tmpDir);
    assert.equal(code, 0, "--archive should exit 0");
    assert.ok(existsSync(join(tmpDir, "out.zip")), "should write out.zip into cwd");
    assert.ok(stdout.includes("已导出"), "should report export summary");
  });
});
