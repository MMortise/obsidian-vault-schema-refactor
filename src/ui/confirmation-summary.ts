import type { ChangePlan, ConflictDecision } from "../domain/types";
import { createTranslator, type Translate } from "../i18n";

function conflictDecisionLabels(t: Translate): Record<ConflictDecision, string> {
  return { block: t("conflictBlock"), "keep-target": t("conflictKeepTarget"), "keep-source": t("conflictKeepSource"), "merge-lists": t("conflictMergeLists") };
}

export interface ConfirmationSummary {
  filesChanging: number;
  excludedFiles: number;
  retainedReferences: number;
  conflictPolicy: string;
}

export function buildConfirmationSummary(plan: ChangePlan, t: Translate = createTranslator("en")): ConfirmationSummary {
  const labels = conflictDecisionLabels(t);
  const overrideCounts = new Map<ConflictDecision, number>();
  for (const decision of Object.values(plan.request.conflictDecisions ?? {})) {
    overrideCounts.set(decision, (overrideCounts.get(decision) ?? 0) + 1);
  }
  const overrides = (Object.entries(labels) as Array<[ConflictDecision, string]>)
    .flatMap(([decision, label]) => {
      const count = overrideCounts.get(decision);
      return count === undefined ? [] : [t("policyOverrideCount", { policy: label, count })];
    });
  const defaultPolicy = labels[plan.request.defaultConflictDecision];
  return {
    filesChanging: plan.fileChanges.length,
    excludedFiles: plan.exclusions.length,
    retainedReferences: plan.exclusions.reduce((sum, exclusion) => sum + exclusion.remainingReferences, 0),
    conflictPolicy: overrides.length === 0
      ? defaultPolicy
      : t("policyDefaultOverrides", { defaultPolicy, overrides: overrides.join(", ") })
  };
}
