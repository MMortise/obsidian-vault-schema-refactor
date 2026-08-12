import type { Vault } from "obsidian";
import { sha256 } from "../domain/hash";
import type { ChangePlan } from "../domain/types";

export interface FreshnessResult {
  fresh: boolean;
  changedPaths: string[];
  missingPaths: string[];
  newCandidatePaths: string[];
}

export async function checkPlanFreshness(vault: Vault, plan: ChangePlan): Promise<FreshnessResult> {
  const changedPaths: string[] = [];
  const missingPaths: string[] = [];
  const newCandidatePaths: string[] = [];
  const known = new Set(Object.keys(plan.sourceSnapshots));
  const files = vault.getFiles().filter((file) => file.extension === "md" || file.extension === "base");
  const byPath = new Map(files.map((file) => [file.path, file]));
  for (const change of plan.fileChanges) {
    const file = byPath.get(change.path);
    if (!file) { missingPaths.push(change.path); continue; }
    if (await sha256(await vault.cachedRead(file)) !== change.beforeHash) changedPaths.push(change.path);
  }
  if (plan.adapterVersion !== "restore-v1") {
    for (const file of files) {
      if (known.has(file.path)) continue;
      const text = await vault.cachedRead(file);
      if (text.includes(plan.request.oldName)) newCandidatePaths.push(file.path);
    }
  }
  return { fresh: changedPaths.length === 0 && missingPaths.length === 0 && newCandidatePaths.length === 0, changedPaths, missingPaths, newCandidatePaths };
}
