import type { ChangePlan, ConflictDecision } from "../domain/types";

const CONFLICT_DECISION_LABELS: Record<ConflictDecision, string> = {
  block: "Block and review",
  "keep-target": "Keep target value",
  "keep-source": "Keep source value",
  "merge-lists": "Merge lists only"
};

export interface ConfirmationSummary {
  filesChanging: number;
  excludedFiles: number;
  retainedReferences: number;
  conflictPolicy: string;
}

export function buildConfirmationSummary(plan: ChangePlan): ConfirmationSummary {
  const overrideCounts = new Map<ConflictDecision, number>();
  for (const decision of Object.values(plan.request.conflictDecisions ?? {})) {
    overrideCounts.set(decision, (overrideCounts.get(decision) ?? 0) + 1);
  }
  const overrides = (Object.entries(CONFLICT_DECISION_LABELS) as Array<[ConflictDecision, string]>)
    .flatMap(([decision, label]) => {
      const count = overrideCounts.get(decision);
      return count === undefined ? [] : [`${label} (${count})`];
    });
  const defaultPolicy = CONFLICT_DECISION_LABELS[plan.request.defaultConflictDecision];
  return {
    filesChanging: plan.fileChanges.length,
    excludedFiles: plan.exclusions.length,
    retainedReferences: plan.exclusions.reduce((sum, exclusion) => sum + exclusion.remainingReferences, 0),
    conflictPolicy: overrides.length === 0
      ? defaultPolicy
      : `${defaultPolicy} by default; per-file overrides: ${overrides.join(", ")}`
  };
}
