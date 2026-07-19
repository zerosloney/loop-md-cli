import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractFrontmatter, extractBody, parseFrontmatter, parseSource } from "../frontmatter.js";

describe("frontmatter", () => {
  it("extracts frontmatter and body from LF file", () => {
    const text = "---\na: 1\n---\nhello";
    assert.equal(extractFrontmatter(text), "a: 1");
    assert.equal(extractBody(text), "hello");
  });

  it("extracts frontmatter and body from CRLF file", () => {
    const text = "---\r\na: 1\r\n---\r\nhello";
    assert.equal(extractFrontmatter(text), "a: 1");
    assert.equal(extractBody(text), "hello");
  });

  it("returns null when no frontmatter", () => {
    assert.equal(extractFrontmatter("no frontmatter here"), null);
    assert.equal(extractBody("no frontmatter here"), "no frontmatter here");
  });

  it("parses scalar and block values", () => {
    const fm = "mode: subagent\ntemperature: 0.1\npermission:\n  edit: deny\n  read: allow";
    const parsed = parseFrontmatter(fm);
    assert.equal(parsed.mode, "subagent");
    assert.equal(parsed.temperature, "0.1");
    assert.ok(parsed.permission.includes("edit: deny"));
    assert.ok(parsed.permission.includes("read: allow"));
  });

  it("parseSource separates frontmatter and body", () => {
    const src = parseSource("---\nkey: val\n---\nbody text");
    assert.equal(src.frontmatter.key, "val");
    assert.equal(src.body, "body text");
  });
});
