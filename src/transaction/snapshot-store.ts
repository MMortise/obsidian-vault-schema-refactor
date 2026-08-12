import type { DataAdapter } from "obsidian";
import { sha256 } from "../domain/hash";
import type { ChangePlan } from "../domain/types";
import type { SnapshotEntry, TransactionManifest, TransactionState } from "./types";

export class SnapshotStore {
  constructor(private readonly adapter: DataAdapter, private readonly root: string) {}

  private transactionPath(transactionId: string): string {
    if (!/^[a-f0-9-]+$/i.test(transactionId)) throw new Error("Invalid transaction ID.");
    return `${this.root}/${transactionId}`;
  }

  private async ensureDirectory(path: string): Promise<void> {
    const parts = path.split("/").filter(Boolean);
    let current = path.startsWith("/") ? "/" : "";
    for (const part of parts) {
      current = current === "" || current === "/" ? `${current}${part}` : `${current}/${part}`;
      if (!await this.adapter.exists(current)) await this.adapter.mkdir(current);
    }
  }

  async create(transactionId: string, plan: ChangePlan): Promise<TransactionManifest> {
    const directory = this.transactionPath(transactionId);
    await this.ensureDirectory(`${directory}/files`);
    const entries: SnapshotEntry[] = await Promise.all(plan.fileChanges.map(async (change) => ({
      path: change.path, snapshotFile: `${await sha256(change.path)}.txt`, beforeHash: change.beforeHash, afterHash: change.afterHash,
      byteLength: new TextEncoder().encode(change.beforeText).length, snapshotted: false, written: false, rollbackRestored: false
    })));
    const now = new Date().toISOString();
    const manifest: TransactionManifest = { schemaVersion: 1, transactionId, planId: plan.planId, createdAt: now, updatedAt: now, state: "SNAPSHOTTING", request: plan.request, entries, verified: [], errors: [] };
    await this.save(manifest);
    for (let index = 0; index < plan.fileChanges.length; index += 1) {
      const change = plan.fileChanges[index];
      const entry = entries[index];
      if (!change || !entry) continue;
      try {
        await this.adapter.write(`${directory}/files/${entry.snapshotFile}`, change.beforeText);
        if (await sha256(await this.adapter.read(`${directory}/files/${entry.snapshotFile}`)) !== change.beforeHash) throw new Error(`Snapshot verification failed: ${change.path}`);
        entry.snapshotted = true;
        await this.save(manifest);
      } catch (error) {
        manifest.errors.push({ stage: "SNAPSHOTTING", message: error instanceof Error ? error.message : "Unknown snapshot error", path: change.path });
        await this.save(manifest);
        return manifest;
      }
    }
    return manifest;
  }

  async save(manifest: TransactionManifest): Promise<void> {
    const directory = this.transactionPath(manifest.transactionId);
    await this.ensureDirectory(directory);
    const next = { ...manifest, updatedAt: new Date().toISOString() };
    const temporary = `${directory}/manifest.tmp.json`;
    const target = `${directory}/manifest.json`;
    const serialized = `${JSON.stringify(next, null, 2)}\n`;
    await this.adapter.write(temporary, serialized);
    const verified = JSON.parse(await this.adapter.read(temporary)) as TransactionManifest;
    if (verified.transactionId !== manifest.transactionId) throw new Error("Snapshot manifest verification failed.");
    await this.adapter.write(target, serialized);
    const persisted = JSON.parse(await this.adapter.read(target)) as TransactionManifest;
    if (persisted.transactionId !== manifest.transactionId) throw new Error("Persisted manifest verification failed.");
    if (await this.adapter.exists(temporary)) await this.adapter.remove(temporary);
  }

  async load(transactionId: string): Promise<TransactionManifest> {
    const directory = this.transactionPath(transactionId);
    const candidates: TransactionManifest[] = [];
    for (const path of [`${directory}/manifest.json`, `${directory}/manifest.tmp.json`]) {
      if (!await this.adapter.exists(path)) continue;
      try {
        const raw = JSON.parse(await this.adapter.read(path)) as unknown;
        if (isManifest(raw) && raw.transactionId === transactionId) candidates.push(raw);
      } catch { /* Try the other journal copy. */ }
    }
    const latest = candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (!latest) throw new Error("Invalid snapshot manifest.");
    return latest;
  }

  async readSnapshot(transactionId: string, entry: SnapshotEntry): Promise<string> {
    if (!/^[a-f0-9]{64}\.txt$/i.test(entry.snapshotFile)) throw new Error("Invalid snapshot filename.");
    const text = await this.adapter.read(`${this.transactionPath(transactionId)}/files/${entry.snapshotFile}`);
    if (await sha256(text) !== entry.beforeHash) throw new Error(`Snapshot hash mismatch: ${entry.path}`);
    return text;
  }

  async list(): Promise<TransactionManifest[]> {
    if (!await this.adapter.exists(this.root)) return [];
    const listing = await this.adapter.list(this.root);
    const manifests: TransactionManifest[] = [];
    for (const folder of listing.folders) {
      const id = folder.split("/").at(-1);
      if (!id || !/^[a-f0-9-]+$/i.test(id)) continue;
      try { manifests.push(await this.load(id)); } catch { /* Invalid manifests are not trusted. */ }
    }
    return manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async prune(retention: number): Promise<void> {
    const manifests = await this.list();
    const cleanable = manifests.filter((manifest) => ["COMPLETED", "ROLLED_BACK", "CANCELLED"].includes(manifest.state));
    for (const manifest of cleanable.slice(Math.max(1, retention))) {
      const directory = this.transactionPath(manifest.transactionId);
      for (const entry of manifest.entries) {
        const file = `${directory}/files/${entry.snapshotFile}`;
        if (await this.adapter.exists(file)) await this.adapter.remove(file);
      }
      for (const file of [`${directory}/manifest.json`, `${directory}/manifest.tmp.json`]) if (await this.adapter.exists(file)) await this.adapter.remove(file);
      const filesDirectory = `${directory}/files`;
      if (await this.adapter.exists(filesDirectory)) await this.adapter.rmdir(filesDirectory, false);
      if (await this.adapter.exists(directory)) await this.adapter.rmdir(directory, false);
    }
  }

  async updateState(manifest: TransactionManifest, state: TransactionState): Promise<void> {
    manifest.state = state;
    await this.save(manifest);
  }
}

function isManifest(value: unknown): value is TransactionManifest {
  if (value === null || typeof value !== "object") return false;
  const item = value as Partial<TransactionManifest>;
  return item.schemaVersion === 1 && typeof item.transactionId === "string" && Array.isArray(item.entries) && typeof item.state === "string";
}
