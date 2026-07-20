import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  computeHash,
  loadManifest,
  saveManifest,
  detectChanges,
  applyChanges,
  manifestPath,
  type Manifest,
} from "../incremental.js";

describe("computeHash", () => {
  it("produces consistent hash for same content", () => {
    const h1 = computeHash("hello");
    const h2 = computeHash("hello");
    assert.equal(h1, h2);
  });

  it("produces different hash for different content", () => {
    const h1 = computeHash("hello");
    const h2 = computeHash("world");
    assert.notEqual(h1, h2);
  });

  it("produces SHA-256 hex output (64 chars)", () => {
    const hash = computeHash("test");
    assert.ok(/^[0-9a-f]{64}$/.test(hash), "should be 64-char hex SHA-256");
  });

  it("empty string has deterministic hash", () => {
    const hash = computeHash("");
    assert.ok(hash.length === 64);
  });
});

describe("manifest", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "loop-forge-inc-test-"));
  });

  it("loads empty manifest when file does not exist", () => {
    const manifest = loadManifest("nonexistent", tmpDir);
    assert.deepEqual(manifest, {});
  });

  it("saves and reloads manifest correctly", () => {
    const manifest: Manifest = {
      "agents/orchestrator.md": { hash: "abc123" },
      "commands/loop.md": { hash: "def456" },
    };
    saveManifest("claude", manifest, tmpDir);
    assert.ok(existsSync(manifestPath("claude", tmpDir)), "manifest file should exist on disk");

    const loaded = loadManifest("claude", tmpDir);
    assert.equal(loaded["agents/orchestrator.md"]?.hash, "abc123");
    assert.equal(loaded["commands/loop.md"]?.hash, "def456");
  });

  it("returns empty manifest for corrupted JSON", () => {
    const path = manifestPath("corrupted", tmpDir);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "{ not valid json", "utf-8");
    const loaded = loadManifest("corrupted", tmpDir);
    assert.deepEqual(loaded, {});
  });

  it("uses cwd to scope manifests (no leakage between cwds)", () => {
    const otherDir = mkdtempSync(join(tmpdir(), "loop-forge-inc-other-"));
    const m1: Manifest = { "a.md": { hash: "1" } };
    const m2: Manifest = { "b.md": { hash: "2" } };
    saveManifest("claude", m1, tmpDir);
    saveManifest("claude", m2, otherDir);

    const loaded1 = loadManifest("claude", tmpDir);
    const loaded2 = loadManifest("claude", otherDir);
    assert.equal(loaded1["a.md"]?.hash, "1");
    assert.equal(loaded2["b.md"]?.hash, "2");
    assert.equal(loaded1["b.md"], undefined, "no cross-cwd leakage");
  });
});

describe("detectChanges", () => {
  it("returns write for new file", () => {
    const expected = new Map<string, string>([
      ["agents/orchestrator.md", "content-v1"],
    ]);
    const manifest: Manifest = {};
    const changes = detectChanges("/tmp/base", expected, manifest);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, "write");
  });

  it("returns skip for unchanged file", () => {
    const content = "same-content";
    const expected = new Map<string, string>([
      ["agents/orchestrator.md", content],
    ]);
    const manifest: Manifest = {
      "agents/orchestrator.md": { hash: computeHash(content) },
    };
    const changes = detectChanges("/tmp/base", expected, manifest);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, "skip");
  });

  it("returns write for changed file", () => {
    const expected = new Map<string, string>([
      ["agents/orchestrator.md", "new-content"],
    ]);
    const manifest: Manifest = {
      "agents/orchestrator.md": { hash: computeHash("old-content") },
    };
    const changes = detectChanges("/tmp/base", expected, manifest);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, "write");
  });

  it("handles multiple files with mixed actions", () => {
    const expected = new Map<string, string>([
      ["agents/orchestrator.md", "content-a"],
      ["agents/executor.md", "content-b"],
      ["commands/loop.md", "content-c"],
    ]);
    const manifest: Manifest = {
      "agents/orchestrator.md": { hash: computeHash("content-a") }, // unchanged
      "agents/executor.md": { hash: computeHash("old-content-b") }, // changed
    };

    const changes = detectChanges("/tmp/base", expected, manifest);
    assert.equal(changes.length, 3);
    assert.equal(changes[0].action, "skip"); // orchestrator unchanged
    assert.equal(changes[1].action, "write"); // executor changed
    assert.equal(changes[2].action, "write"); // loop is new
  });

  // ─── 缺陷 3 回归：detectChanges 必须为 manifest 里有、expected 里没有的条目生成 delete ───
  // 旧实现完全不扫描孤儿，导致切换领域时旧文件永久残留。

  it("returns delete for manifest entries absent from expected (orphan cleanup)", () => {
    const expected = new Map<string, string>([
      ["agents/orchestrator.md", "v2"],
    ]);
    const manifest: Manifest = {
      "agents/orchestrator.md": { hash: computeHash("v1") }, // 仍存在，会 write
      "agents/old-agent.md": { hash: computeHash("old") }, // 孤儿，应 delete
      "commands/old-cmd.md": { hash: computeHash("old") }, // 孤儿，应 delete
    };

    const changes = detectChanges("/tmp/base", expected, manifest);
    const deletes = changes.filter((c) => c.action === "delete");
    assert.equal(deletes.length, 2, "should detect both orphan files");
    const deletePaths = deletes.map((c) => c.relativePath).sort();
    assert.deepEqual(deletePaths, ["agents/old-agent.md", "commands/old-cmd.md"]);
    // write 仍在
    assert.ok(changes.some((c) => c.action === "write" && c.relativePath === "agents/orchestrator.md"));
  });
});

describe("applyChanges", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "loop-forge-apply-test-"));
  });

  it("updates manifest with new hashes", () => {
    const content = "test-content";
    const changes = [
      { relativePath: "agents/orchestrator.md", fullPath: join(tmpDir, "agents/orchestrator.md"), action: "write" as const, content },
    ];
    const manifest: Manifest = {};

    applyChanges(changes, manifest);

    assert.ok(manifest["agents/orchestrator.md"]);
    assert.equal(manifest["agents/orchestrator.md"]!.hash, computeHash(content));
    assert.ok(existsSync(join(tmpDir, "agents/orchestrator.md")), "file should be written to disk");
  });

  it("skips non-write actions", () => {
    const changes = [
      { relativePath: "agents/orchestrator.md", fullPath: join(tmpDir, "a.md"), action: "skip" as const, content: "ignored" },
    ];
    const manifest: Manifest = {};

    applyChanges(changes, manifest);

    assert.equal(Object.keys(manifest).length, 0, "skip actions should not update manifest");
    assert.ok(!existsSync(join(tmpDir, "a.md")), "skip action should not write file");
  });

  it("updates manifest for multiple write actions", () => {
    const changes = [
      { relativePath: "agents/orchestrator.md", fullPath: join(tmpDir, "a.md"), action: "write" as const, content: "content-a" },
      { relativePath: "commands/loop.md", fullPath: join(tmpDir, "c.md"), action: "write" as const, content: "content-c" },
    ];
    const manifest: Manifest = {};

    applyChanges(changes, manifest);

    assert.equal(Object.keys(manifest).length, 2);
    assert.equal(manifest["agents/orchestrator.md"]!.hash, computeHash("content-a"));
    assert.equal(manifest["commands/loop.md"]!.hash, computeHash("content-c"));
  });

  // ─── 缺陷 3 回归：applyChanges 必须真正删盘 + 从 manifest 移除条目 ───

  it("deletes orphan file on disk and removes manifest entry", () => {
    // 先在临时目录里造一个"上次生成过的"文件
    const orphanPath = join(tmpDir, "agents", "old-agent.md");
    mkdirSync(join(tmpDir, "agents"), { recursive: true });
    writeFileSync(orphanPath, "old content", "utf-8");
    assert.ok(existsSync(orphanPath), "precondition: orphan file should exist");

    const changes = [
      { relativePath: "agents/old-agent.md", fullPath: orphanPath, action: "delete" as const },
    ];
    const manifest: Manifest = {
      "agents/old-agent.md": { hash: computeHash("old content") },
    };

    applyChanges(changes, manifest);

    assert.ok(!existsSync(orphanPath), "orphan file should be deleted from disk");
    assert.equal(manifest["agents/old-agent.md"], undefined, "manifest entry should be removed");
  });

  it("delete is tolerant when file already gone (no throw)", () => {
    // 文件已被手动删除的情况——delete 不应抛
    const gonePath = join(tmpDir, "agents", "already-gone.md");
    const changes = [
      { relativePath: "agents/already-gone.md", fullPath: gonePath, action: "delete" as const },
    ];
    const manifest: Manifest = {
      "agents/already-gone.md": { hash: "whatever" },
    };

    assert.doesNotThrow(() => applyChanges(changes, manifest));
    assert.equal(manifest["agents/already-gone.md"], undefined, "manifest entry still cleaned");
  });

  it("end-to-end: switching expected set prunes old files and keeps current ones", () => {
    // 模拟领域切换：第一轮 expected = {A, B}，第二轮 expected = {B, C}
    // 预期：A 被删，B 保留（内容不变则 skip），C 写入，manifest 最终 = {B, C}
    const baseDir = join(tmpDir, "platform-x");
    mkdirSync(baseDir, { recursive: true });

    const manifest: Manifest = {};

    // Round 1
    const r1Expected = new Map<string, string>([
      ["a.md", "content-A"],
      ["b.md", "content-B"],
    ]);
    const r1Changes = detectChanges(baseDir, r1Expected, manifest);
    applyChanges(r1Changes, manifest);
    assert.ok(existsSync(join(baseDir, "a.md")));
    assert.ok(existsSync(join(baseDir, "b.md")));

    // Round 2: a.md 消失，c.md 新增，b.md 不变
    const r2Expected = new Map<string, string>([
      ["b.md", "content-B"],
      ["c.md", "content-C"],
    ]);
    const r2Changes = detectChanges(baseDir, r2Expected, manifest);
    applyChanges(r2Changes, manifest);

    // 磁盘：a 删，b 留，c 写
    assert.ok(!existsSync(join(baseDir, "a.md")), "a.md (orphan) should be pruned");
    assert.ok(existsSync(join(baseDir, "b.md")), "b.md should be retained");
    assert.ok(existsSync(join(baseDir, "c.md")), "c.md should be written");

    // manifest 精确等于 {b.md, c.md}
    assert.deepEqual(Object.keys(manifest).sort(), ["b.md", "c.md"]);
    assert.equal(manifest["b.md"]!.hash, computeHash("content-B"));
    assert.equal(manifest["c.md"]!.hash, computeHash("content-C"));
  });
});
