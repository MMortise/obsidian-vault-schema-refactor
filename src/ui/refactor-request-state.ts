import type { ChangePlan, ConflictDecision } from "../domain/types";

export class RefactorRequestState {
  oldName = "";
  newName = "";
  excludedPaths = new Set<string>();
  conflictDecisions: Record<string, ConflictDecision> = {};
  resultMessage = "";
  reviewedPlan: ChangePlan | undefined;

  setOldName(value: string): void {
    if (value === this.oldName) return;
    this.oldName = value;
    this.invalidateReview();
  }

  setNewName(value: string): void {
    if (value === this.newName) return;
    this.newName = value;
    this.invalidateReview();
  }

  setReviewedPlan(plan: ChangePlan): void {
    this.reviewedPlan = plan;
  }

  invalidateReview(): void {
    this.reviewedPlan = undefined;
    this.excludedPaths.clear();
    this.conflictDecisions = {};
    this.resultMessage = "";
  }
}
