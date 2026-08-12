import type { Vault } from "obsidian";
import { describe, expect, it } from "vitest";
import { VaultInventory } from "../src/inventory/vault-inventory";
import { buildRenamePlan } from "../src/planning/plan-builder";

interface TestFile {
  path: string;
  extension: string;
  stat: { mtime: number; size: number };
}

function testVault(contents: Record<string, string>): Vault {
  const files = Object.entries(contents).map(([path, text]): TestFile => ({
    path, extension: path.endsWith(".base") ? "base" : "md", stat: { mtime: 1, size: text.length }
  }));
  return {
    getFiles: () => files,
    cachedRead: (file: TestFile) => Promise.resolve(contents[file.path] ?? "")
  } as unknown as Vault;
}

describe("inventory memory retention", () => {
  it("drops Markdown bodies while retaining Base source needed by the index", async () => {
    const contents: Record<string, string> = {
      "affected.md": "---\nstatus: open\n---\nlarge body that should not be retained",
      "unaffected.md": "---\nowner: me\n---\nanother body",
      "projects.base": "filters: note.status == \"open\"\n"
    };
    const inventory = await new VaultInventory(testVault(contents)).scan();
    expect(inventory.markdown.every((document) => document.snapshot.text === "")).toBe(true);
    expect(inventory.snapshots.filter((snapshot) => snapshot.kind === "markdown").every((snapshot) => snapshot.text === "")).toBe(true);
    expect(inventory.bases[0]?.snapshot.text).toBe(contents["projects.base"]);
  });

  it("rereads only a selected Markdown source before building its change", async () => {
    const contents: Record<string, string> = {
      "affected.md": "---\nstatus: open\n---\nbody",
      "unaffected.md": "---\nowner: me\n---\nbody"
    };
    const inventory = await new VaultInventory(testVault(contents)).scan();
    const reads: string[] = [];
    const plan = await buildRenamePlan(inventory, { oldName: "status", newName: "state", defaultConflictDecision: "block" }, "2026-08-12T00:00:00Z", (path) => {
      reads.push(path);
      return Promise.resolve(contents[path] ?? "");
    });
    expect(reads).toEqual(["affected.md"]);
    expect(plan.status).toBe("ready");
    expect(plan.fileChanges[0]?.beforeText).toBe(contents["affected.md"]);
  });
});
