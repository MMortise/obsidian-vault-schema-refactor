import { describe, expect, it } from "vitest";
import type { ChangePlan } from "../src/domain/types";
import { RefactorRequestState } from "../src/ui/refactor-request-state";

const reviewedPlan = { request: { oldName: "status", newName: "state" } } as ChangePlan;

describe("RefactorRequestState", () => {
  it("invalidates the reviewed plan and selections when either property changes", () => {
    const state = new RefactorRequestState();
    state.oldName = "status";
    state.newName = "state";
    state.setReviewedPlan(reviewedPlan);
    state.excludedPaths.add("excluded.md");
    state.conflictDecisions["conflict.md"] = "keep-source";
    state.resultMessage = "Reviewed";

    state.setNewName("phase");

    expect(state.reviewedPlan).toBeUndefined();
    expect(state.excludedPaths.size).toBe(0);
    expect(state.conflictDecisions).toEqual({});
    expect(state.resultMessage).toBe("");
  });

  it("keeps the reviewed plan when an input event repeats the same value", () => {
    const state = new RefactorRequestState();
    state.oldName = "status";
    state.newName = "state";
    state.setReviewedPlan(reviewedPlan);

    state.setOldName("status");

    expect(state.reviewedPlan).toBe(reviewedPlan);
  });
});
