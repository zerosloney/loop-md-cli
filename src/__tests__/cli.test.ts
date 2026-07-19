import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const cliPath = join(__dirname, "..", "cli.js");
    const proc = spawn(process.execPath, [cliPath, ...args], {
      cwd: join(__dirname, ".."),
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    proc.stdout.on("data", (c: Buffer) => stdout.push(c));
    proc.stderr.on("data", (c: Buffer) => stderr.push(c));
    proc.on("close", (code) => {
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
    assert.ok(stdout.includes("loop-forge"), "should contain program name");
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
    assert.equal(stdout.trim(), "0.1.0", "version should match package.json");
  });

  it("-v is alias for --version", async () => {
    const { stdout, code } = await runCli(["-v"]);
    assert.equal(code, 0);
    assert.ok(/^\d+\.\d+\.\d+$/.test(stdout.trim()));
  });

  it("--version reads from package.json", async () => {
    const { stdout } = await runCli(["--version"]);
    assert.equal(stdout.trim(), "0.1.0");
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
    assert.ok(combined.includes("未知选项") || combined.includes("未知参数"), "should mention unknown option");
    assert.ok(combined.includes("--help"), "should suggest --help");
  });
});
