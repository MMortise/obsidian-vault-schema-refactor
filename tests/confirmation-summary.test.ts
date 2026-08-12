import { describe, expect, it } from "vitest";
import type { ChangePlan } from "../src/domain/types";
import { buildConfirmationSummary } from "../src/ui/confirmation-summary";

function plan(overrides: Partial<ChangePlan> = {}): ChangePlan {
  return {
    schemaVersion: 1,
    planId: "plan",
    inventoryRevision: "revision",
    adapterVersion: "bases-1.9-v1",
    createdAt: "2026-08-12T00:00:00.000Z",
    request: { oldName: "status", newName: "state", defaultConflictDecision: "keep-target" },
    sourceSnapshots: {},
    fileChanges: [],
    unresolvedFindings: [],
    exclusions: [],
    status: "ready",
    ...overrides
  };
}

describe("confirmation summary", () => {
  it("shows the reviewed conflict policy and retained reference count", () => {
    const summary = buildConfirmationSummary(plan({
      fileChanges: [
        { path: "a.md" },
        { path: "view.base" }
      ] as ChangePlan["fileChanges"],
      exclusions: [
        { path: "excluded.md", remainingReferences: 1 },
        { path: "excluded.base", remainingReferences: 4 }
      ]
    }));

    expect(summary).toEqual({
      filesChanging: 2,
      excludedFiles: 2,
      retainedReferences: 5,
      conflictPolicy: "Keep target value"
    });
  });

  it("includes every per-file conflict policy override", () => {
    const summary = buildConfirmationSummary(plan({
      request: {
        oldName: "status",
        newName: "state",
        defaultConflictDecision: "block",
        conflictDecisions: {
          "a.md": "keep-source",
          "b.md": "keep-source",
          "c.md": "merge-lists"
        }
      }
    }));

    expect(summary.conflictPolicy).toBe("Block and review by default; per-file overrides: Keep source value (2), Merge lists only (1)");
  });
});
