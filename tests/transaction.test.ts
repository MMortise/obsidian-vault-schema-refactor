import type { DataAdapter } from "obsidian";
import { describe, expect, it } from "vitest";
import { sha256 } from "../src/domain/hash";
import type { ChangePlan, FileChange } from "../src/domain/types";
import { TransactionExecutor } from "../src/transaction/executor";
import { SnapshotStore } from "../src/transaction/snapshot-store";
import type { TransactionFileStore, TransactionManifest } from "../src/transaction/types";

class MemoryFiles implements TransactionFileStore {
  readonly values = new Map<string, string>();
  async read(path: string): Promise<string> { const value = this.values.get(path); if (value === undefined) throw new Error(`Missing ${path}`); return value; }
  async write(path: string, text: string): Promise<void> { this.values.set(path, text); }
  async exists(path: string): Promise<boolean> { return this.values.has(path); }
}

class MemoryAdapter {
  readonly files = new Map<string, string>();
  readonly folders = new Set<string>();
  async exists(path: string): Promise<boolean> { return this.files.has(path) || this.folders.has(path); }
  async mkdir(path: string): Promise<void> { this.folders.add(path); }
  async write(path: string, text: string): Promise<void> { this.files.set(path, text); }
  async read(path: string): Promise<string> { const value = this.files.get(path); if (value === undefined) throw new Error(`Missing ${path}`); return value; }
  async remove(path: string): Promise<void> { this.files.delete(path); }
  async rename(from: string, to: string): Promise<void> { const value = await this.read(from); this.files.set(to, value); this.files.delete(from); }
  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    return { files: [...this.files.keys()].filter((item) => item.startsWith(`${path}/`)), folders: [...this.folders].filter((item) => item.startsWith(`${path}/`) && !item.slice(path.length + 1).includes("/")) };
  }
}

async function change(path: string, beforeText: string, afterText: string): Promise<FileChange> {
  return { path, kind: "markdown", beforeHash: await sha256(beforeText), beforeText, afterText, afterHash: await sha256(afterText), operations: [{ kind: "frontmatter-key", structuralPath: ["status"], before: "status", after: "state", reason: "test" }], validation: { valid: true, warnings: [], blockers: [] } };
}

async function plan(): Promise<ChangePlan> {
  const fileChanges = [await change("a.md", "---\nstatus: a\n---\n", "---\nstate: a\n---\n"), await change("b.md", "---\nstatus: b\n---\n", "---\nstate: b\n---\n")];
  return { schemaVersion: 1, planId: "plan", inventoryRevision: "inventory", adapterVersion: "test", createdAt: "2026-08-12T00:00:00Z", request: { oldName: "status", newName: "state", defaultConflictDecision: "block" }, sourceSnapshots: Object.fromEntries(fileChanges.map((item) => [item.path, { contentHash: item.beforeHash, mtime: 1, size: item.beforeText.length }])), fileChanges, unresolvedFindings: [], exclusions: [], status: "ready" };
}

function setup(data: ChangePlan): { files: MemoryFiles; adapter: MemoryAdapter; snapshots: SnapshotStore; executor: TransactionExecutor } {
  const files = new MemoryFiles();
  for (const item of data.fileChanges) files.values.set(item.path, item.beforeText);
  const adapter = new MemoryAdapter();
  const snapshots = new SnapshotStore(adapter as unknown as DataAdapter, ".plugin/snapshots");
  return { files, adapter, snapshots, executor: new TransactionExecutor(files, snapshots) };
}

describe("TransactionExecutor", () => {
  it("writes exactly the reviewed bytes and completes verification", async () => {
    const data = await plan();
    const { files, executor, snapshots } = setup(data);
    const result = await executor.execute(data);
    expect(result.state).toBe("COMPLETED");
    for (const item of data.fileChanges) expect(await files.read(item.path)).toBe(item.afterText);
    expect((await snapshots.load(result.transactionId)).state).toBe("COMPLETED");
  });

  it("restores every prior file when the Nth write fails", async () => {
    const data = await plan();
    const { files, executor } = setup(data);
    const result = await executor.execute(data, { injectFailure: (point, path) => { if (point === "before-write" && path === "b.md") throw new Error("disk full"); } });
    expect(result.state).toBe("ROLLED_BACK");
    for (const item of data.fileChanges) expect(await files.read(item.path)).toBe(item.beforeText);
  });

  it("recovers safely after write intent but before source modification", async () => {
    const data = await plan();
    const { files, executor } = setup(data);
    const result = await executor.execute(data, { injectFailure: (point, path) => { if (point === "after-write-intent" && path === "a.md") throw new Error("crash"); } });
    expect(result.state).toBe("ROLLED_BACK");
    expect(await files.read("a.md")).toBe(data.fileChanges[0]?.beforeText);
  });

  it("does not overwrite an external edit after write intent is persisted", async () => {
    const data = await plan();
    const { files, executor } = setup(data);
    const result = await executor.execute(data, {
      injectFailure: async (point, path) => {
        if (point === "after-write-intent" && path === "a.md") await files.write("a.md", "external edit");
      }
    });
    expect(result.state).toBe("ROLLBACK_INCOMPLETE");
    expect(result.rollbackIncompletePaths).toEqual(["a.md"]);
    expect(await files.read("a.md")).toBe("external edit");
  });

  it("does not overwrite an externally changed file during rollback", async () => {
    const data = await plan();
    const { files, executor } = setup(data);
    const result = await executor.execute(data, {
      injectFailure: async (point, path) => {
        if (point === "after-write" && path === "a.md") {
          await files.write("a.md", "external edit");
          throw new Error("sync changed file");
        }
      }
    });
    expect(result.state).toBe("ROLLBACK_INCOMPLETE");
    expect(result.rollbackIncompletePaths).toEqual(["a.md"]);
    expect(await files.read("a.md")).toBe("external edit");
  });

  it("does not overwrite an external edit arriving immediately before rollback write", async () => {
    const data = await plan();
    const { files, executor } = setup(data);
    const result = await executor.execute(data, {
      injectFailure: async (point, path) => {
        if (point === "before-write" && path === "b.md") throw new Error("force rollback");
        if (point === "before-rollback-write" && path === "a.md") await files.write("a.md", "external during rollback");
      }
    });
    expect(result.state).toBe("ROLLBACK_INCOMPLETE");
    expect(result.rollbackIncompletePaths).toEqual(["a.md"]);
    expect(await files.read("a.md")).toBe("external during rollback");
  });

  it("restores a known corrupt write result", async () => {
    const data = await plan();
    const { files, executor } = setup(data);
    const originalWrite = files.write.bind(files);
    let corrupt = true;
    files.write = async (path, text) => {
      if (corrupt && path === "a.md" && text === data.fileChanges[0]?.afterText) {
        corrupt = false;
        await originalWrite(path, `${text}corrupt`);
      } else await originalWrite(path, text);
    };
    const result = await executor.execute(data);
    expect(result.state).toBe("ROLLED_BACK");
    expect(await files.read("a.md")).toBe(data.fileChanges[0]?.beforeText);
  });

  it("recovers a persisted partial write idempotently", async () => {
    const data = await plan();
    const { files, executor, snapshots } = setup(data);
    const manifest = await snapshots.create("deadbeef-dead-beef-dead-beefdeadbeef", data);
    await files.write("a.md", data.fileChanges[0]?.afterText ?? "");
    const entry = manifest.entries[0];
    if (!entry) throw new Error("Missing entry");
    entry.written = true;
    manifest.state = "WRITING";
    await snapshots.save(manifest);
    const recovered = await executor.recover(await snapshots.load(manifest.transactionId));
    expect(recovered?.state).toBe("ROLLED_BACK");
    expect(await files.read("a.md")).toBe(data.fileChanges[0]?.beforeText);
    expect(await executor.recover(await snapshots.load(manifest.transactionId))).toBeUndefined();
  });

  it("cancels a journal that never wrote source files", async () => {
    const data = await plan();
    const { executor, snapshots } = setup(data);
    const manifest: TransactionManifest = await snapshots.create("feedface-feed-face-feed-facefeedface", data);
    expect(await executor.recover(manifest)).toBeUndefined();
    expect((await snapshots.load(manifest.transactionId)).state).toBe("CANCELLED");
  });

  it("loads the valid temporary journal when the primary journal is corrupt", async () => {
    const data = await plan();
    const { adapter, snapshots } = setup(data);
    const manifest = await snapshots.create("abc123-abc123", data);
    const root = `.plugin/snapshots/${manifest.transactionId}`;
    const serialized = adapter.files.get(`${root}/manifest.json`);
    if (!serialized) throw new Error("Missing journal");
    adapter.files.set(`${root}/manifest.tmp.json`, serialized);
    adapter.files.set(`${root}/manifest.json`, "{corrupt");
    expect((await snapshots.load(manifest.transactionId)).transactionId).toBe(manifest.transactionId);
  });
});
