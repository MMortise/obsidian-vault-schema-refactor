import type { TFile, Vault } from "obsidian";
import { describe, expect, it } from "vitest";
import { sha256 } from "../src/domain/hash";
import type { ChangePlan } from "../src/domain/types";
import { checkPlanFreshness } from "../src/planning/plan-validator";

interface TestFile {
  path: string;
  extension: string;
}

function vaultWith(contents: Record<string, string>): Vault {
  const files: TestFile[] = Object.keys(contents).map((path) => ({ path, extension: path.endsWith(".base") ? "base" : "md" }));
  return {
    getFiles: () => files,
    cachedRead: (file: TestFile) => Promise.resolve(contents[file.path] ?? "")
  } as unknown as Vault;
}

async function planFrom(scanned: Record<string, string>): Promise<ChangePlan> {
  const sourceSnapshots: ChangePlan["sourceSnapshots"] = {};
  for (const [path, text] of Object.entries(scanned)) sourceSnapshots[path] = { contentHash: await sha256(text), mtime: 1, size: text.length };
  const beforeText = scanned["affected.md"] ?? "";
  const afterText = beforeText.replace("status:", "state:");
  return {
    schemaVersion: 1, planId: "plan", inventoryRevision: "revision", adapterVersion: "bases-1.9-v1", createdAt: "2026-08-12T00:00:00Z",
    request: { oldName: "status", newName: "state", defaultConflictDecision: "block" }, sourceSnapshots,
    fileChanges: [{ path: "affected.md", kind: "markdown", beforeHash: await sha256(beforeText), beforeText, afterText, afterHash: await sha256(afterText), operations: [], validation: { valid: true, warnings: [], blockers: [] } }],
    unresolvedFindings: [], exclusions: [], status: "ready"
  };
}

describe("plan freshness", () => {
  it("accepts an unchanged inventory", async () => {
    const scanned = { "affected.md": "---\nstatus: open\n---\n", "unaffected.md": "---\nowner: me\n---\n" };
    expect((await checkPlanFreshness(vaultWith(scanned), await planFrom(scanned))).fresh).toBe(true);
  });

  it("invalidates when a previously unaffected scanned file changes", async () => {
    const scanned = { "affected.md": "---\nstatus: open\n---\n", "unaffected.md": "---\nowner: me\n---\n" };
    const current = { ...scanned, "unaffected.md": "---\nowner: me\nstatus: new\n---\n" };
    const result = await checkPlanFreshness(vaultWith(current), await planFrom(scanned));
    expect(result.fresh).toBe(false);
    expect(result.changedPaths).toEqual(["unaffected.md"]);
  });

  it("invalidates when any scanned file is removed", async () => {
    const scanned = { "affected.md": "---\nstatus: open\n---\n", "unaffected.md": "---\nowner: me\n---\n" };
    const result = await checkPlanFreshness(vaultWith({ "affected.md": scanned["affected.md"] }), await planFrom(scanned));
    expect(result.fresh).toBe(false);
    expect(result.missingPaths).toEqual(["unaffected.md"]);
  });
});
