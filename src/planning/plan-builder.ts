import { BASE_ADAPTER_VERSION, parseBase, renameBaseReferences } from "../adapters/bases-config-adapter";
import { parseMarkdown, renameFrontmatterKey } from "../adapters/markdown-frontmatter-adapter";
import { sha256, stableStringify } from "../domain/hash";
import { validateRename } from "../domain/property-name";
import type { BaseConflictDecision, ChangePlan, Confidence, ConflictDecision, FileChange, Finding, InventoryResult, RenamePropertyRequest, Severity, SourceSnapshot } from "../domain/types";

function decisionFor(request: RenamePropertyRequest, path: string): ConflictDecision {
  return request.conflictDecisions?.[path] ?? request.defaultConflictDecision;
}

function baseDecisionFor(request: RenamePropertyRequest, path: string): BaseConflictDecision {
  const decision = request.conflictDecisions?.[path];
  return decision === "keep-target" || decision === "keep-source" ? decision : "block";
}

async function planFinding(ruleId: string, path: string, message: string, evidence?: string, severity: Severity = "blocker", confidence: Confidence = "exact", structuralPath?: Array<string | number>): Promise<Finding> {
  const fingerprint = await sha256(stableStringify({ ruleId, path, evidence, structuralPath }));
  return {
    id: fingerprint.slice(0, 20), ruleId, severity, filePath: path, confidence, message,
    fingerprint, suggestedAction: "manual-review", ...(evidence ? { evidence } : {}), ...(structuralPath ? { structuralPath } : {})
  };
}

function sourceRecord(snapshots: SourceSnapshot[]): ChangePlan["sourceSnapshots"] {
  return Object.fromEntries(snapshots.map(({ path, contentHash, mtime, size }) => [path, { contentHash, mtime, size }]));
}

export async function buildRenamePlan(
  inventory: InventoryResult,
  input: RenamePropertyRequest,
  now = new Date().toISOString(),
  readText?: (path: string) => Promise<string>
): Promise<ChangePlan> {
  const request: RenamePropertyRequest = {
    oldName: input.oldName, newName: input.newName, defaultConflictDecision: input.defaultConflictDecision,
    ...(input.conflictDecisions ? { conflictDecisions: Object.fromEntries(Object.entries(input.conflictDecisions).sort(([a], [b]) => a.localeCompare(b))) } : {}),
    ...(input.excludedPaths ? { excludedPaths: [...input.excludedPaths].sort() } : {})
  };
  const excluded = new Set(request.excludedPaths ?? []);
  const fileChanges: FileChange[] = [];
  const unresolvedFindings: Finding[] = [];
  const exclusions: ChangePlan["exclusions"] = [];
  for (const error of validateRename(request.oldName, request.newName)) unresolvedFindings.push(await planFinding("INVALID_REQUEST", "", error));

  for (const markdown of inventory.markdown) {
    if (!markdown.properties.has(request.oldName)) continue;
    if (excluded.has(markdown.snapshot.path)) {
      exclusions.push({ path: markdown.snapshot.path, remainingReferences: 1 });
      continue;
    }
    const beforeText = markdown.snapshot.text !== "" || markdown.snapshot.size === 0
      ? markdown.snapshot.text
      : readText ? await readText(markdown.snapshot.path) : undefined;
    if (beforeText === undefined) {
      unresolvedFindings.push(await planFinding("SOURCE_NOT_LOADED", markdown.snapshot.path, "The source file must be reread before planning."));
      continue;
    }
    if (await sha256(beforeText) !== markdown.snapshot.contentHash) {
      unresolvedFindings.push(await planFinding("STALE_SOURCE", markdown.snapshot.path, "The source file changed after the inventory scan. Rescan before planning."));
      continue;
    }
    const result = await renameFrontmatterKey(beforeText, request.oldName, request.newName, decisionFor(request, markdown.snapshot.path));
    for (const blocker of result.blockers) unresolvedFindings.push(await planFinding("MARKDOWN_CONFLICT", markdown.snapshot.path, blocker));
    if (result.afterText !== beforeText && result.blockers.length === 0) fileChanges.push({
      path: markdown.snapshot.path, kind: "markdown", beforeHash: markdown.snapshot.contentHash, beforeText,
      afterText: result.afterText, afterHash: result.afterHash, operations: result.operations, validation: { valid: true, warnings: [], blockers: [] }
    });
  }

  for (const base of inventory.bases) {
    const oldReferences = base.references.filter((reference) => reference.propertyName === request.oldName && reference.confidence === "exact");
    const reviewReferences = base.references.filter((reference) => reference.propertyName === request.oldName && reference.confidence !== "exact");
    for (const reference of reviewReferences) {
      unresolvedFindings.push(await planFinding(
        "LOW_CONFIDENCE_REFERENCE", base.snapshot.path,
        `A ${reference.confidence} reference to '${request.oldName}' requires manual review and will not be changed.`,
        reference.evidence, "warning", reference.confidence, reference.structuralPath
      ));
    }
    const suspiciousText = base.snapshot.text.includes(request.oldName);
    if (base.parseError) {
      if (suspiciousText) unresolvedFindings.push(await planFinding("UNPARSEABLE_BASE", base.snapshot.path, "This Base may contain the old property but cannot be parsed.", base.parseError));
      continue;
    }
    const riskyUnknown = base.unknownShapes.find((shape) => shape.path[0] !== undefined && ["filters", "properties", "formulas", "summaries", "views"].includes(String(shape.path[0])) && shape.searchText?.includes(request.oldName));
    if (riskyUnknown) unresolvedFindings.push(await planFinding("UNKNOWN_BASE_SHAPE", base.snapshot.path, "An unknown node in a known reference field may contain the old property.", riskyUnknown.evidence));
    if (oldReferences.length === 0) continue;
    if (excluded.has(base.snapshot.path)) {
      exclusions.push({ path: base.snapshot.path, remainingReferences: oldReferences.length });
      continue;
    }
    const result = await renameBaseReferences(base.snapshot.text, request.oldName, request.newName, baseDecisionFor(request, base.snapshot.path));
    for (const blocker of result.blockers) unresolvedFindings.push(await planFinding("BASE_CONFLICT", base.snapshot.path, blocker));
    if (result.afterText !== base.snapshot.text && result.blockers.length === 0) {
      const parsedAfter = await parseBase({ ...base.snapshot, text: result.afterText, contentHash: result.afterHash, size: new TextEncoder().encode(result.afterText).length });
      const remaining = parsedAfter.references.filter((reference) => reference.propertyName === request.oldName && reference.confidence === "exact");
      const blockers = [...(parsedAfter.parseError ? [parsedAfter.parseError] : []), ...(remaining.length > 0 ? [`${remaining.length} exact references remain.`] : [])];
      if (blockers.length > 0) unresolvedFindings.push(await planFinding("PLAN_VALIDATION", base.snapshot.path, blockers.join(" ")));
      else fileChanges.push({
        path: base.snapshot.path, kind: "base", beforeHash: base.snapshot.contentHash, beforeText: base.snapshot.text,
        afterText: result.afterText, afterHash: result.afterHash, operations: result.operations, validation: { valid: true, warnings: [], blockers: [] }
      });
    }
  }
  fileChanges.sort((a, b) => a.path.localeCompare(b.path));
  exclusions.sort((a, b) => a.path.localeCompare(b.path));
  if (fileChanges.length === 0 && unresolvedFindings.length === 0) unresolvedFindings.push(await planFinding("EMPTY_PLAN", "", "No old property definitions or references were found."));
  const planSeed = { inventoryRevision: inventory.revision, adapterVersion: BASE_ADAPTER_VERSION, request, changes: fileChanges.map(({ path, beforeHash, afterHash, operations }) => ({ path, beforeHash, afterHash, operations })), exclusions };
  const planId = (await sha256(stableStringify(planSeed))).slice(0, 24);
  return {
    schemaVersion: 1, planId, inventoryRevision: inventory.revision, adapterVersion: BASE_ADAPTER_VERSION, createdAt: now, request,
    sourceSnapshots: sourceRecord(inventory.snapshots), fileChanges, unresolvedFindings, exclusions,
    status: unresolvedFindings.some((item) => item.severity === "blocker") || fileChanges.length === 0 ? "draft" : "ready"
  };
}

export async function validatePlannedOutputs(plan: ChangePlan): Promise<string[]> {
  const errors: string[] = [];
  for (const change of plan.fileChanges) {
    if (await sha256(change.beforeText) !== change.beforeHash) errors.push(`${change.path}: before hash mismatch`);
    if (await sha256(change.afterText) !== change.afterHash) errors.push(`${change.path}: after hash mismatch`);
    if (change.beforeText === change.afterText) errors.push(`${change.path}: no content change`);
    if (change.kind === "markdown") {
      const parsed = await parseMarkdown({ path: change.path, kind: "markdown", text: change.afterText, contentHash: change.afterHash, mtime: 0, size: change.afterText.length });
      if (parsed.parseError) errors.push(`${change.path}: ${parsed.parseError}`);
    } else {
      const parsed = await parseBase({ path: change.path, kind: "base", text: change.afterText, contentHash: change.afterHash, mtime: 0, size: change.afterText.length });
      if (parsed.parseError) errors.push(`${change.path}: ${parsed.parseError}`);
    }
  }
  return errors;
}
