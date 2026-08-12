import { sha256, stableStringify } from "../domain/hash";
import type { Finding, InventoryResult, Severity } from "../domain/types";

async function finding(ruleId: string, severity: Severity, filePath: string, message: string, options: Partial<Pick<Finding, "structuralPath" | "confidence" | "evidence" | "suggestedAction" | "refactorRequest">> = {}): Promise<Finding> {
  const structuralPath = options.structuralPath;
  const fingerprint = await sha256(stableStringify({ ruleId, filePath, structuralPath, evidence: options.evidence }));
  return {
    id: fingerprint.slice(0, 20), ruleId, severity, filePath, message, confidence: options.confidence ?? "exact", fingerprint,
    ...(structuralPath ? { structuralPath } : {}), ...(options.evidence ? { evidence: options.evidence } : {}),
    ...(options.suggestedAction ? { suggestedAction: options.suggestedAction } : {}),
    ...(options.refactorRequest ? { refactorRequest: options.refactorRequest } : {})
  };
}

export async function runDoctor(inventory: InventoryResult): Promise<Finding[]> {
  const findings: Finding[] = [];
  const properties = new Set(inventory.propertyTypes.keys());
  for (const base of inventory.bases) {
    if (base.parseError) findings.push(await finding("UNPARSEABLE_BASE", "error", base.snapshot.path, "This Base could not be parsed.", { evidence: base.parseError, suggestedAction: "open-file" }));
    for (const unknown of base.unknownShapes) findings.push(await finding("UNKNOWN_BASE_SHAPE", "warning", base.snapshot.path, "This configuration shape is not understood and was left untouched.", { structuralPath: unknown.path, evidence: unknown.evidence, suggestedAction: "manual-review" }));
    for (const reference of base.references.filter((item) => item.confidence === "exact" && !properties.has(item.propertyName))) {
      findings.push(await finding("MISSING_PROPERTY", "warning", base.snapshot.path, `Property '${reference.propertyName}' has no instances in the Vault.`, {
        structuralPath: reference.structuralPath, evidence: reference.evidence, suggestedAction: "create-refactor",
        refactorRequest: { oldName: reference.propertyName, newName: "" }
      }));
    }
    const definitions = new Set(base.formulaDefinitions);
    const allUses = new Set([...base.formulaRoots, ...Object.values(base.formulaDependencies).flat()].filter(Boolean));
    for (const name of allUses) if (!definitions.has(name)) findings.push(await finding("MISSING_FORMULA", "error", base.snapshot.path, `Formula '${name}' is referenced but not defined.`, { evidence: `formula.${name}`, suggestedAction: "open-file" }));
    const reachable = reachableFormulas(base.formulaRoots, base.formulaDependencies);
    if (base.unknownShapes.length === 0) for (const name of definitions) if (!reachable.has(name)) findings.push(await finding("UNUSED_FORMULA", "info", base.snapshot.path, `Formula '${name}' is defined but not reachable from a known view or filter.`, { evidence: name, suggestedAction: "open-file" }));
  }
  const names = [...properties].sort();
  const caseGroups = new Map<string, string[]>();
  for (const name of names) {
    const normalized = name.normalize("NFC").toLocaleLowerCase();
    caseGroups.set(normalized, [...(caseGroups.get(normalized) ?? []), name]);
  }
  for (const group of caseGroups.values()) if (group.length > 1) {
    const ordered = [...group].sort((a, b) => a.localeCompare(b));
    const target = ordered.find((name) => name === name.toLocaleLowerCase()) ?? ordered[0];
    const source = ordered.find((name) => name !== target);
    findings.push(await finding("CASE_DRIFT", "warning", "", `Properties differ only by case: ${group.join(", ")}.`, {
      evidence: group.join(", "), suggestedAction: "create-refactor",
      ...(source && target ? { refactorRequest: { oldName: source, newName: target } } : {})
    }));
  }
  for (const [name, kinds] of inventory.propertyTypes) {
    const material = [...kinds].filter((kind) => kind !== "null");
    if (material.length > 1) findings.push(await finding("TYPE_DRIFT", "warning", "", `Property '${name}' has incompatible value types: ${material.sort().join(", ")}.`, { evidence: `${name}: ${material.sort().join(",")}`, suggestedAction: "manual-review" }));
  }
  const unique = new Map(findings.map((item) => [item.fingerprint, item]));
  return [...unique.values()].sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.filePath.localeCompare(b.filePath) || a.ruleId.localeCompare(b.ruleId));
}

export function reachableFormulas(roots: string[], dependencies: Record<string, string[]>): Set<string> {
  const reachable = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    const name = pending.pop();
    if (!name || reachable.has(name)) continue;
    reachable.add(name);
    pending.push(...(dependencies[name] ?? []));
  }
  return reachable;
}

function severityRank(severity: Severity): number {
  return { blocker: 0, error: 1, warning: 2, info: 3 }[severity];
}
