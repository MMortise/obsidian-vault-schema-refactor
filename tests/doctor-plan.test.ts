import { describe, expect, it } from "vitest";
import { parseBase } from "../src/adapters/bases-config-adapter";
import { parseMarkdown } from "../src/adapters/markdown-frontmatter-adapter";
import { runDoctor } from "../src/doctor/rule-engine";
import { sha256 } from "../src/domain/hash";
import type { BaseDocument, InventoryResult, MarkdownDocument, SourceSnapshot, ValueKind } from "../src/domain/types";
import { buildRenamePlan, validatePlannedOutputs } from "../src/planning/plan-builder";
import { createReport, reportToJson, reportToMarkdown } from "../src/report/report";

async function source(path: string, kind: "markdown" | "base", text: string): Promise<SourceSnapshot> {
  return { path, kind, text, contentHash: await sha256(text), mtime: 1, size: text.length };
}

async function inventory(markdownInputs: Record<string, string>, baseInputs: Record<string, string>): Promise<InventoryResult> {
  const markdown: MarkdownDocument[] = [];
  const bases: BaseDocument[] = [];
  const propertyTypes = new Map<string, Set<ValueKind>>();
  for (const [path, text] of Object.entries(markdownInputs)) {
    const document = await parseMarkdown(await source(path, "markdown", text));
    markdown.push(document);
    for (const [name, kind] of document.properties) {
      const kinds = propertyTypes.get(name) ?? new Set<ValueKind>();
      kinds.add(kind);
      propertyTypes.set(name, kinds);
    }
  }
  for (const [path, text] of Object.entries(baseInputs)) bases.push(await parseBase(await source(path, "base", text)));
  const snapshots = [...markdown.map((item) => item.snapshot), ...bases.map((item) => item.snapshot)];
  return { revision: await sha256(snapshots.map((item) => item.contentHash).join()), snapshots, markdown, bases, propertyTypes, references: bases.flatMap((item) => item.references), errors: [] };
}

describe("Doctor", () => {
  it("emits all core semantic rules with stable fingerprints", async () => {
    const data = await inventory(
      { "a.md": "---\nStatus: open\nscore: 1\n---\n", "b.md": "---\nstatus: open\nscore: high\n---\n" },
      { "issues.base": "filters: note.missing == 1\nformulas:\n  unused: note.status\nviews:\n  - order: [formula.unknown]\n", "broken.base": "filters: [" }
    );
    const findings = await runDoctor(data);
    const rules = new Set(findings.map((item) => item.ruleId));
    expect(rules).toEqual(new Set(["UNPARSEABLE_BASE", "MISSING_PROPERTY", "MISSING_FORMULA", "UNUSED_FORMULA", "CASE_DRIFT", "TYPE_DRIFT"]));
    expect((await runDoctor(data)).map((item) => item.fingerprint)).toEqual(findings.map((item) => item.fingerprint));
  });

  it("does not report formula references found only in literals or comments", async () => {
    const data = await inventory({}, { "formulas.base": "formulas:\n  shown: '\"formula.missing\" + 1 // formula.alsoMissing'\nviews:\n  - order: [formula.shown]\n" });
    const findings = await runDoctor(data);
    expect(findings.some((item) => item.ruleId === "MISSING_FORMULA")).toBe(false);
  });

  it("exports matching private reports", async () => {
    const data = await inventory({}, { "a.base": "filters: note.missing == 1\n" });
    const report = createReport(await runDoctor(data), "0.1.0", "2026-08-12T00:00:00.000Z");
    const json = reportToJson(report);
    const markdown = reportToMarkdown(report);
    const parsed = JSON.parse(json) as { findings: unknown[] };
    expect(parsed.findings).toHaveLength(report.findings.length);
    expect(markdown).toContain("MISSING_PROPERTY");
    expect(json).not.toContain(process.cwd());
  });

  it("escapes untrusted Markdown report fields", async () => {
    const data = await inventory({}, { "<script>|.base": "filters: note.missing == 1\n" });
    const markdown = reportToMarkdown(createReport(await runDoctor(data), "0.1.0"));
    expect(markdown).not.toContain("<script>");
    expect(markdown).toContain("&lt;script&gt;\\|");
  });
});

describe("Plan builder", () => {
  it("builds deterministic parseable changes for Markdown and Bases", async () => {
    const data = await inventory(
      { "project.md": "---\nstatus: active\n---\nbody status\n" },
      { "projects.base": "filters: note.status == \"active\"\nviews:\n  - order: [note.status]\n" }
    );
    const request = { oldName: "status", newName: "state", defaultConflictDecision: "block" as const };
    const first = await buildRenamePlan(data, request, "2026-08-12T00:00:00.000Z");
    const second = await buildRenamePlan(data, request, "2026-08-12T00:01:00.000Z");
    expect(first.status).toBe("ready");
    expect(first.fileChanges).toHaveLength(2);
    expect(first.planId).toBe(second.planId);
    expect(await validatePlannedOutputs(first)).toEqual([]);
    expect(first.fileChanges.find((change) => change.path === "project.md")?.afterText).toContain("body status");
  });

  it("blocks unresolved conflicts and honors exclusions", async () => {
    const data = await inventory({ "conflict.md": "---\nstatus: old\nstate: new\n---\n" }, {});
    const blocked = await buildRenamePlan(data, { oldName: "status", newName: "state", defaultConflictDecision: "block" });
    expect(blocked.status).toBe("draft");
    expect(blocked.unresolvedFindings[0]?.ruleId).toBe("MARKDOWN_CONFLICT");
    const excluded = await buildRenamePlan(data, { oldName: "status", newName: "state", defaultConflictDecision: "keep-target", excludedPaths: ["conflict.md"] });
    expect(excluded.exclusions).toEqual([{ path: "conflict.md", remainingReferences: 1 }]);
  });

  it("blocks an unknown known-field shape only when it may contain the old property", async () => {
    const risky = await inventory({ "a.md": "---\nstatus: open\n---\n" }, { "risky.base": "views: note.status\n" });
    const riskyPlan = await buildRenamePlan(risky, { oldName: "status", newName: "state", defaultConflictDecision: "block" });
    expect(riskyPlan.unresolvedFindings.some((item) => item.ruleId === "UNKNOWN_BASE_SHAPE")).toBe(true);
    const unrelated = await inventory({ "a.md": "---\nstatus: open\n---\n" }, { "safe.base": "views: note.owner\n" });
    const safePlan = await buildRenamePlan(unrelated, { oldName: "status", newName: "state", defaultConflictDecision: "block" });
    expect(safePlan.unresolvedFindings.some((item) => item.ruleId === "UNKNOWN_BASE_SHAPE")).toBe(false);
  });

  it("carries probable references into a read-only reference-only review", async () => {
    const data = await inventory({}, { "probable.base": "filters: status == \"active\"\n" });
    const plan = await buildRenamePlan(data, { oldName: "status", newName: "state", defaultConflictDecision: "block" });
    expect(plan.fileChanges).toEqual([]);
    expect(plan.status).toBe("draft");
    expect(plan.unresolvedFindings).toContainEqual(expect.objectContaining({
      ruleId: "LOW_CONFIDENCE_REFERENCE", severity: "warning", confidence: "probable", filePath: "probable.base", evidence: "status"
    }));
    expect(plan.unresolvedFindings.some((item) => item.ruleId === "EMPTY_PLAN")).toBe(false);
  });

  it("keeps a mixed exact and probable plan ready while never writing the probable reference", async () => {
    const data = await inventory(
      { "project.md": "---\nstatus: active\n---\n" },
      { "mixed.base": "filters:\n  and:\n    - note.status == \"active\"\n    - status == \"active\"\n" }
    );
    const plan = await buildRenamePlan(data, { oldName: "status", newName: "state", defaultConflictDecision: "block" });
    expect(plan.status).toBe("ready");
    expect(plan.unresolvedFindings).toContainEqual(expect.objectContaining({ ruleId: "LOW_CONFIDENCE_REFERENCE", confidence: "probable" }));
    const baseChange = plan.fileChanges.find((change) => change.path === "mixed.base");
    expect(baseChange?.afterText).toContain("note.state");
    expect(baseChange?.afterText).toContain('- status == "active"');
  });
});
