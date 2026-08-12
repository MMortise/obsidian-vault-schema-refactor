import { describe, expect, it } from "vitest";
import { resolveScanConcurrency } from "../src/app/settings-runtime";
import type { InventoryResult, PropertyReference } from "../src/domain/types";
import { buildRenamePlan } from "../src/planning/plan-builder";
import { createReport, reportToJson } from "../src/report/report";

describe("runtime settings", () => {
  it("uses low concurrency on mobile or in low-resource mode", () => {
    expect(resolveScanConcurrency(false, false)).toBe(8);
    expect(resolveScanConcurrency(false, true)).toBe(2);
    expect(resolveScanConcurrency(true, false)).toBe(2);
  });

  it("includes text matches in Review only when enabled", async () => {
    const reference: PropertyReference = {
      id: "text", filePath: "text.base", fileKind: "base", semanticKind: "base-filter", structuralPath: ["filters"],
      syntaxForm: "bare-identifier", propertyName: "status", confidence: "text", evidence: "status"
    };
    const snapshot = { path: "text.base", kind: "base" as const, text: "x-status-text", contentHash: "hash", mtime: 1, size: 13 };
    const inventory: InventoryResult = {
      revision: "revision", snapshots: [snapshot], markdown: [], bases: [{ snapshot, references: [reference], formulaDefinitions: [], formulaRoots: [], formulaDependencies: {}, unknownShapes: [] }],
      propertyTypes: new Map(), references: [reference], errors: []
    };
    const request = { oldName: "status", newName: "state", defaultConflictDecision: "block" as const };
    const hidden = await buildRenamePlan(inventory, request, "2026-08-12T00:00:00Z", undefined, false);
    const shown = await buildRenamePlan(inventory, request, "2026-08-12T00:00:00Z", undefined, true);
    expect(hidden.unresolvedFindings.some((item) => item.confidence === "text")).toBe(false);
    expect(shown.unresolvedFindings).toContainEqual(expect.objectContaining({ confidence: "text", ruleId: "LOW_CONFIDENCE_REFERENCE" }));
  });

  it("adds type statistics to JSON only when enabled", () => {
    const propertyTypes = new Map([["status", new Set(["string" as const, "null" as const])]]);
    const without = reportToJson(createReport([], "0.1.0", "2026-08-12T00:00:00Z", { includeTypeStats: false, propertyTypes }));
    const withStats = reportToJson(createReport([], "0.1.0", "2026-08-12T00:00:00Z", { includeTypeStats: true, propertyTypes }));
    expect(JSON.parse(without)).not.toHaveProperty("propertyTypes");
    expect(JSON.parse(withStats)).toHaveProperty("propertyTypes.status", ["null", "string"]);
  });
});
