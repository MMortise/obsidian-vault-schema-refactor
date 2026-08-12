import { sha256, stableStringify } from "../domain/hash";
import type { ChangePlan, FileChange } from "../domain/types";
import type { SnapshotStore } from "./snapshot-store";
import type { TransactionFileStore, TransactionManifest } from "./types";

export interface RestorePlanResult {
  plan: ChangePlan;
  divergedPaths: string[];
  missingPaths: string[];
}

export async function buildRestorePlan(files: TransactionFileStore, snapshots: SnapshotStore, manifest: TransactionManifest): Promise<RestorePlanResult> {
  if (manifest.state !== "COMPLETED") throw new Error("Only completed transactions can be undone.");
  const fileChanges: FileChange[] = [];
  const divergedPaths: string[] = [];
  const missingPaths: string[] = [];
  for (const entry of manifest.entries) {
    if (!await files.exists(entry.path)) { missingPaths.push(entry.path); continue; }
    const current = await files.read(entry.path);
    if (await sha256(current) !== entry.afterHash) { divergedPaths.push(entry.path); continue; }
    const before = await snapshots.readSnapshot(manifest.transactionId, entry);
    fileChanges.push({
      path: entry.path, kind: entry.path.endsWith(".base") ? "base" : "markdown", beforeHash: entry.afterHash, beforeText: current,
      afterText: before, afterHash: entry.beforeHash,
      operations: [{ kind: entry.path.endsWith(".base") ? "base-property-config" : "frontmatter-key", structuralPath: [], before: manifest.request.newName, after: manifest.request.oldName, reason: `Restore transaction ${manifest.transactionId}` }],
      validation: { valid: true, warnings: [], blockers: [] }
    });
  }
  fileChanges.sort((a, b) => a.path.localeCompare(b.path));
  const seed = { restoreOf: manifest.transactionId, changes: fileChanges.map(({ path, beforeHash, afterHash }) => ({ path, beforeHash, afterHash })) };
  const planId = (await sha256(stableStringify(seed))).slice(0, 24);
  const sourceSnapshots = Object.fromEntries(fileChanges.map((change) => [change.path, { contentHash: change.beforeHash, mtime: 0, size: change.beforeText.length }]));
  const plan: ChangePlan = {
    schemaVersion: 1, planId, inventoryRevision: planId, adapterVersion: "restore-v1", createdAt: new Date().toISOString(),
    request: { oldName: manifest.request.newName, newName: manifest.request.oldName, defaultConflictDecision: "block", excludedPaths: [...divergedPaths, ...missingPaths].sort() },
    sourceSnapshots, fileChanges, unresolvedFindings: [],
    exclusions: [...divergedPaths, ...missingPaths].sort().map((path) => ({ path, remainingReferences: 1 })), status: fileChanges.length > 0 ? "ready" : "draft"
  };
  return { plan, divergedPaths, missingPaths };
}
