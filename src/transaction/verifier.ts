import { parseBase } from "../adapters/bases-config-adapter";
import { parseMarkdown } from "../adapters/markdown-frontmatter-adapter";
import { sha256 } from "../domain/hash";
import type { ChangePlan, SourceSnapshot } from "../domain/types";
import type { TransactionFileStore } from "./types";

export async function verifyPlanApplied(files: TransactionFileStore, plan: ChangePlan): Promise<string[]> {
  const errors: string[] = [];
  for (const change of plan.fileChanges) {
    const text = await files.read(change.path);
    const hash = await sha256(text);
    if (hash !== change.afterHash) { errors.push(`${change.path}: written bytes differ from the reviewed plan`); continue; }
    const snapshot: SourceSnapshot = { path: change.path, kind: change.kind, text, contentHash: hash, mtime: 0, size: text.length };
    if (change.kind === "markdown") {
      const parsed = await parseMarkdown(snapshot);
      if (parsed.parseError) errors.push(`${change.path}: ${parsed.parseError}`);
      if (parsed.properties.has(plan.request.oldName)) errors.push(`${change.path}: old property remains`);
      if (!parsed.properties.has(plan.request.newName)) errors.push(`${change.path}: new property is missing`);
    } else {
      const parsed = await parseBase(snapshot);
      if (parsed.parseError) errors.push(`${change.path}: ${parsed.parseError}`);
      if (parsed.references.some((reference) => reference.confidence === "exact" && reference.propertyName === plan.request.oldName)) errors.push(`${change.path}: exact old references remain`);
    }
  }
  return errors;
}
