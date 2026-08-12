import { describe, expect, it } from "vitest";
import { ApplyProgressState } from "../src/ui/apply-progress-state";

describe("ApplyProgressState", () => {
  it("cannot close while a transaction is running", () => {
    const progress = new ApplyProgressState();
    for (const state of ["PREPARING", "SNAPSHOTTING", "WRITING", "VERIFYING", "ROLLING_BACK"] as const) {
      progress.update(state, "project.md");
      expect(progress.canClose()).toBe(false);
      expect(progress.path).toBe("project.md");
    }
  });

  it("allows closing only after every terminal result", () => {
    for (const state of ["COMPLETED", "ROLLED_BACK", "ROLLBACK_INCOMPLETE"] as const) {
      const progress = new ApplyProgressState();
      progress.update(state);
      expect(progress.canClose()).toBe(true);
    }
  });

  it("allows closing after an exception before a terminal transaction state", () => {
    const progress = new ApplyProgressState();
    progress.fail("Plan is stale");
    expect(progress.canClose()).toBe(true);
    expect(progress.message).toBe("Plan is stale");
  });
});
