import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseBase, renameBaseReferences } from "../src/adapters/bases-config-adapter";
import { replaceExactProperty, scanExpression, scanFormulaReferences } from "../src/adapters/expression-reference-adapter";
import { parseMarkdown, renameFrontmatterKey } from "../src/adapters/markdown-frontmatter-adapter";
import { sha256 } from "../src/domain/hash";
import type { SourceSnapshot } from "../src/domain/types";

async function snapshot(path: string, kind: "markdown" | "base", text: string): Promise<SourceSnapshot> {
  return { path, kind, text, contentHash: await sha256(text), mtime: 1, size: new TextEncoder().encode(text).length };
}

describe("expression adapter", () => {
  it("only promotes note-prefixed references to exact", () => {
    const matches = scanExpression('note.status == "status" && file.status && formula.status && status && statusText');
    expect(matches.filter((match) => match.confidence === "exact").map((match) => match.evidence)).toEqual(["note.status"]);
    expect(matches.some((match) => match.evidence === "status" && match.confidence === "probable")).toBe(true);
  });

  it("replaces exact occurrences while preserving literals and other namespaces", () => {
    const result = replaceExactProperty('note.status == "note.status" && file.status && note.status', "status", "state");
    expect(result.text).toBe('note.state == "note.status" && file.status && note.state');
    expect(result.replacements).toHaveLength(2);
  });

  it("does not truncate chained, dotted, bracket, or method access", () => {
    const expression = "note.project.status && note.project-status && note.status.value && note[\"status\"] && note.status()";
    expect(scanExpression(expression).filter((match) => match.confidence === "exact")).toEqual([]);
    expect(replaceExactProperty(expression, "status", "state").text).toBe(expression);
  });

  it("skips expression comments", () => {
    const expression = "// note.status\n/* note.status */ note.owner";
    expect(scanExpression(expression).filter((match) => match.confidence === "exact").map((match) => match.evidence)).toEqual(["note.owner"]);
  });

  it("indexes formula references only in executable expression text", () => {
    const expression = 'formula.real + "formula.string" + /formula.regex/ + total / formula.divisor // formula.line\n/* formula.block */';
    expect(scanFormulaReferences(expression)).toEqual(["real", "divisor"]);
  });
});

describe("markdown adapter", () => {
  it("renames only a top-level key and leaves the body byte-identical", async () => {
    const input = await readFile("fixtures/markdown/formatting.md", "utf8");
    const result = await renameFrontmatterKey(input, "status", "state", "block");
    expect(result.blockers).toEqual([]);
    expect(result.afterText).toContain("state: active");
    expect(result.afterText).toContain("  status: untouched");
    expect(result.afterText.split("---\n").at(-1)).toBe(input.split("---\n").at(-1));
    const parsed = await parseMarkdown(await snapshot("formatting.md", "markdown", result.afterText));
    expect([...parsed.properties.keys()]).toEqual(["state", "quoted", "list", "nested"]);
  });

  it("enforces conflict decisions", async () => {
    const input = "---\nstatus: old\nstate: current\n---\nbody\n";
    expect((await renameFrontmatterKey(input, "status", "state", "block")).blockers).toHaveLength(1);
    expect((await renameFrontmatterKey(input, "status", "state", "keep-target")).afterText).toContain("state: current");
    expect((await renameFrontmatterKey(input, "status", "state", "keep-source")).afterText).toContain("state: old");
  });

  it("merges lists without changing target order", async () => {
    const input = "---\nstatus: [two, three]\nstate: [one, two]\n---\n";
    const result = await renameFrontmatterKey(input, "status", "state", "merge-lists");
    expect(result.blockers).toEqual([]);
    const parsed = await parseMarkdown(await snapshot("lists.md", "markdown", result.afterText));
    expect(parsed.properties.get("state")).toBe("list");
    expect(result.afterText).toContain("  - one\n  - two\n  - three");
  });

  it("preserves BOM and CRLF line endings", async () => {
    const input = "\uFEFF---\r\nstatus: active\r\nother: value\r\n---\r\nbody\r\n";
    const result = await renameFrontmatterKey(input, "status", "state", "block");
    expect(result.afterText.startsWith("\uFEFF---\r\nstate: active\r\n")).toBe(true);
    expect(result.afterText.replaceAll("\r\n", "")).not.toContain("\n");
  });
});

describe("Bases adapter", () => {
  it("indexes known structures and reports unknown shape", async () => {
    const input = await readFile("fixtures/bases/1.9/complete.base", "utf8");
    const result = await parseBase(await snapshot("complete.base", "base", input));
    expect(result.parseError).toBeUndefined();
    expect(result.references.filter((reference) => reference.propertyName === "status" && reference.confidence === "exact").length).toBeGreaterThanOrEqual(7);
    expect(result.references.some((reference) => reference.evidence === "file.status")).toBe(false);
    expect(result.unknownShapes).toContainEqual({ path: ["x-community-field"], evidence: "Unknown top-level field: x-community-field" });
  });

  it("rewrites supported exact references and preserves unknown content", async () => {
    const input = await readFile("fixtures/bases/1.9/complete.base", "utf8");
    const result = await renameBaseReferences(input, "status", "state", "block");
    expect(result.blockers).toEqual([]);
    expect(result.afterText).toContain("note.state");
    expect(result.afterText).toContain("file.status");
    expect(result.afterText).toContain("untouched: note.status");
    expect(result.afterText).toContain("customPluginOption:");
    const parsed = await parseBase(await snapshot("complete.base", "base", result.afterText));
    expect(parsed.parseError).toBeUndefined();
    expect(parsed.references.some((reference) => reference.propertyName === "status" && reference.confidence === "exact")).toBe(false);
  });

  it("preserves Base CRLF line endings", async () => {
    const input = "\uFEFFfilters: note.status == \"active\"\r\nviews:\r\n  - order: [note.status]\r\n";
    const result = await renameBaseReferences(input, "status", "state", "block");
    expect(result.afterText.startsWith("\uFEFF")).toBe(true);
    expect(result.afterText).toContain("note.state");
    expect(result.afterText.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("blocks unverified expression syntax for a special target name", async () => {
    const input = "filters: note.status == \"active\"\nviews:\n  - order: [note.status]\n";
    const result = await renameBaseReferences(input, "status", "project-status", "block");
    expect(result.blockers[0]).toContain("no verified dot-access");
    expect(result.afterText).toBe(input);
  });

  it("allows special target names in serialized property IDs when no expression uses them", async () => {
    const input = "properties:\n  note.status:\n    displayName: Status\nviews:\n  - order: [note.status]\n";
    const result = await renameBaseReferences(input, "status", "project-status", "block");
    expect(result.blockers).toEqual([]);
    expect(result.afterText).toContain("note.project-status");
  });
});
