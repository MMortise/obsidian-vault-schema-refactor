import type { DataAdapter } from "obsidian";
import { describe, expect, it } from "vitest";
import { sha256 } from "../src/domain/hash";
import { buildRestorePlan } from "../src/transaction/restore-plan";
import { SnapshotStore } from "../src/transaction/snapshot-store";
import type { TransactionFileStore, TransactionManifest } from "../src/transaction/types";

class Files implements TransactionFileStore {
  values = new Map<string, string>();
  async read(path: string): Promise<string> { const value = this.values.get(path); if (value === undefined) throw new Error("missing"); return value; }
  async write(path: string, text: string): Promise<void> { this.values.set(path, text); }
  async exists(path: string): Promise<boolean> { return this.values.has(path); }
}

describe("restore plan", () => {
  it("includes unchanged results and excludes divergent files", async () => {
    const beforeA = "---\nstatus: a\n---\n";
    const afterA = "---\nstate: a\n---\n";
    const beforeB = "---\nstatus: b\n---\n";
    const afterB = "---\nstate: b\n---\n";
    const adapterFiles = new Map<string, string>();
    const adapter = {
      exists: async (path: string) => adapterFiles.has(path), mkdir: async () => undefined,
      write: async (path: string, text: string) => { adapterFiles.set(path, text); },
      read: async (path: string) => { const value = adapterFiles.get(path); if (value === undefined) throw new Error("missing"); return value; },
      remove: async () => undefined, rename: async () => undefined, list: async () => ({ files: [], folders: [] })
    } as unknown as DataAdapter;
    const snapshots = new SnapshotStore(adapter, ".snapshots");
    const entryA = { path: "a.md", snapshotFile: `${await sha256("a.md")}.txt`, beforeHash: await sha256(beforeA), afterHash: await sha256(afterA), byteLength: beforeA.length, written: true, rollbackRestored: false };
    const entryB = { path: "b.md", snapshotFile: `${await sha256("b.md")}.txt`, beforeHash: await sha256(beforeB), afterHash: await sha256(afterB), byteLength: beforeB.length, written: true, rollbackRestored: false };
    adapterFiles.set(`.snapshots/deadbeef/files/${entryA.snapshotFile}`, beforeA);
    adapterFiles.set(`.snapshots/deadbeef/files/${entryB.snapshotFile}`, beforeB);
    const manifest: TransactionManifest = { schemaVersion: 1, transactionId: "deadbeef", planId: "plan", createdAt: "2026-08-12T00:00:00Z", updatedAt: "2026-08-12T00:00:00Z", state: "COMPLETED", request: { oldName: "status", newName: "state", defaultConflictDecision: "block" }, entries: [entryA, entryB], verified: ["a.md", "b.md"], errors: [] };
    const files = new Files();
    files.values.set("a.md", afterA);
    files.values.set("b.md", `${afterB}external`);
    const result = await buildRestorePlan(files, snapshots, manifest);
    expect(result.plan.fileChanges.map((item) => item.path)).toEqual(["a.md"]);
    expect(result.divergedPaths).toEqual(["b.md"]);
    expect(result.plan.fileChanges[0]?.afterText).toBe(beforeA);
  });
});
