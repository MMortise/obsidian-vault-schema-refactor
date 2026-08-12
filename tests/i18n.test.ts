import { describe, expect, it } from "vitest";
import type { Finding } from "../src/domain/types";
import { createTranslator, findingMessage, normalizeLanguage, transactionStateLabel } from "../src/i18n";
import { buildConfirmationSummary } from "../src/ui/confirmation-summary";
import type { ChangePlan } from "../src/domain/types";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "finding",
    ruleId: "UNKNOWN_BASE_SHAPE",
    severity: "warning",
    filePath: "view.base",
    confidence: "probable",
    message: "Original message",
    fingerprint: "fingerprint",
    ...overrides
  };
}

function plan(): ChangePlan {
  return {
    schemaVersion: 1,
    planId: "plan",
    inventoryRevision: "revision",
    adapterVersion: "bases-1.9-v1",
    createdAt: "2026-08-12T00:00:00.000Z",
    request: { oldName: "status", newName: "state", defaultConflictDecision: "keep-target" },
    sourceSnapshots: {},
    fileChanges: [{ path: "note.md" } as ChangePlan["fileChanges"][number]],
    unresolvedFindings: [],
    exclusions: [{ path: "excluded.md", remainingReferences: 2 }],
    status: "ready"
  };
}

describe("i18n", () => {
  it("defaults unknown or missing settings to English", () => {
    expect(normalizeLanguage(undefined)).toBe("en");
    expect(normalizeLanguage("fr")).toBe("en");
    expect(normalizeLanguage("zh-CN")).toBe("zh-CN");
  });

  it("translates messages and interpolates values", () => {
    const zh = createTranslator("zh-CN");
    expect(zh("language")).toBe("语言");
    expect(zh("filesWillChange", { count: 3 })).toBe("将修改 3 个文件");
  });

  it("translates every transaction state", () => {
    const en = createTranslator("en");
    const zh = createTranslator("zh-CN");
    expect(transactionStateLabel("ROLLING_BACK", en)).toBe("rolling back");
    expect(transactionStateLabel("ROLLING_BACK", zh)).toBe("正在回滚");
  });

  it("uses the safer blocker message for risky unknown Base shapes", () => {
    const zh = createTranslator("zh-CN");
    expect(findingMessage(finding({ severity: "blocker" }), zh)).toBe("已知引用字段中的未知节点可能包含原属性。");
  });

  it.each(["MARKDOWN_CONFLICT", "BASE_CONFLICT", "PLAN_VALIDATION"])(
    "preserves the specific diagnostic for %s",
    (ruleId) => {
      const detail = "Property 'display name' has no verified dot-access expression syntax.";
      expect(findingMessage(finding({ ruleId, severity: "blocker", message: detail }), createTranslator("zh-CN"))).toBe(detail);
    }
  );

  it("builds confirmation facts in Chinese", () => {
    const summary = buildConfirmationSummary(plan(), createTranslator("zh-CN"));
    expect(summary).toEqual({
      filesChanging: 1,
      excludedFiles: 1,
      retainedReferences: 2,
      conflictPolicy: "保留目标值"
    });
  });
});
