import { sha256 } from "../domain/hash";
import type { ChangePlan } from "../domain/types";
import { verifyPlanApplied } from "./verifier";
import type { SnapshotStore } from "./snapshot-store";
import type { TransactionFileStore, TransactionHooks, TransactionManifest, TransactionResult, TransactionState } from "./types";

export class TransactionExecutor {
  private active = false;

  constructor(private readonly files: TransactionFileStore, private readonly snapshots: SnapshotStore) {}

  async execute(plan: ChangePlan, hooks: TransactionHooks = {}): Promise<TransactionResult> {
    if (this.active) throw new Error("Another Schema Refactor transaction is already running.");
    if (plan.status !== "ready" || plan.fileChanges.length === 0) throw new Error("Only a non-empty ready plan can be applied.");
    this.active = true;
    const transactionId = crypto.randomUUID();
    let manifest: TransactionManifest | undefined;
    let stage: TransactionState = "PREPARING";
    try {
      hooks.onState?.(stage);
      await hooks.injectFailure?.("before-freshness");
      for (const change of plan.fileChanges) {
        if (!await this.files.exists(change.path) || await sha256(await this.files.read(change.path)) !== change.beforeHash) throw new Error(`Plan is stale: ${change.path}`);
      }
      stage = "SNAPSHOTTING";
      hooks.onState?.(stage);
      await hooks.injectFailure?.("before-snapshot-manifest");
      manifest = await this.snapshots.create(transactionId, plan);
      await hooks.injectFailure?.("after-snapshot-manifest");
      stage = "WRITING";
      await this.snapshots.updateState(manifest, stage);
      for (const change of [...plan.fileChanges].sort((a, b) => a.path.localeCompare(b.path))) {
        hooks.onState?.(stage, change.path);
        await hooks.injectFailure?.("before-write", change.path);
        if (await sha256(await this.files.read(change.path)) !== change.beforeHash) throw new Error(`File changed during apply: ${change.path}`);
        const entry = manifest.entries.find((item) => item.path === change.path);
        if (entry) entry.written = true;
        await this.snapshots.save(manifest);
        await hooks.injectFailure?.("after-write-intent", change.path);
        await this.files.write(change.path, change.afterText);
        const writtenHash = await sha256(await this.files.read(change.path));
        if (entry) entry.writtenHash = writtenHash;
        await this.snapshots.save(manifest);
        await hooks.injectFailure?.("after-write", change.path);
        if (writtenHash !== change.afterHash) throw new Error(`Write verification failed: ${change.path}`);
      }
      stage = "VERIFYING";
      await this.snapshots.updateState(manifest, stage);
      hooks.onState?.(stage);
      await hooks.injectFailure?.("before-verification");
      const verificationErrors = await verifyPlanApplied(this.files, plan);
      if (verificationErrors.length > 0) throw new Error(verificationErrors.join("; "));
      manifest.verified = manifest.entries.map((entry) => entry.path);
      stage = "COMPLETED";
      await this.snapshots.updateState(manifest, stage);
      hooks.onState?.(stage);
      return resultFrom(manifest, "COMPLETED");
    } catch (error) {
      if (!manifest) throw error;
      manifest.errors.push({ stage, message: error instanceof Error ? error.message : "Unknown transaction error" });
      return await this.rollback(manifest, hooks);
    } finally {
      this.active = false;
    }
  }

  async recover(manifest: TransactionManifest, hooks: TransactionHooks = {}): Promise<TransactionResult | undefined> {
    if (["COMPLETED", "ROLLED_BACK", "ROLLBACK_INCOMPLETE"].includes(manifest.state)) return undefined;
    if (!manifest.entries.some((entry) => entry.written)) {
      await this.snapshots.updateState(manifest, "CANCELLED");
      return undefined;
    }
    return this.rollback(manifest, hooks);
  }

  private async rollback(manifest: TransactionManifest, hooks: TransactionHooks): Promise<TransactionResult> {
    manifest.state = "ROLLING_BACK";
    await this.snapshots.save(manifest);
    const incomplete: string[] = [];
    for (const entry of [...manifest.entries].reverse()) {
      if (!entry.written || entry.rollbackRestored) continue;
      hooks.onState?.("ROLLING_BACK", entry.path);
      try {
        await hooks.injectFailure?.("before-rollback", entry.path);
        const currentHash = await this.files.exists(entry.path) ? await sha256(await this.files.read(entry.path)) : undefined;
        if (currentHash === entry.beforeHash) {
          entry.rollbackRestored = true;
          await this.snapshots.save(manifest);
          continue;
        }
        if (currentHash === undefined || (currentHash !== entry.afterHash && currentHash !== entry.writtenHash)) {
          incomplete.push(entry.path);
          continue;
        }
        const beforeText = await this.snapshots.readSnapshot(manifest.transactionId, entry);
        await this.files.write(entry.path, beforeText);
        if (await sha256(await this.files.read(entry.path)) !== entry.beforeHash) throw new Error("Restored hash does not match snapshot.");
        entry.rollbackRestored = true;
        await this.snapshots.save(manifest);
      } catch (error) {
        incomplete.push(entry.path);
        manifest.errors.push({ stage: "ROLLING_BACK", path: entry.path, message: error instanceof Error ? error.message : "Unknown rollback error" });
      }
    }
    const state = incomplete.length === 0 ? "ROLLED_BACK" : "ROLLBACK_INCOMPLETE";
    await this.snapshots.updateState(manifest, state);
    hooks.onState?.(state);
    return resultFrom(manifest, state, incomplete);
  }
}

function resultFrom(manifest: TransactionManifest, state: TransactionResult["state"], incomplete: string[] = []): TransactionResult {
  return { transactionId: manifest.transactionId, state, errors: manifest.errors, modifiedPaths: manifest.entries.filter((entry) => entry.written).map((entry) => entry.path), rollbackIncompletePaths: incomplete };
}
