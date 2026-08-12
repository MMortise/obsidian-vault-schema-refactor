import { isMap, isScalar, isSeq, parseDocument, Scalar, type Document, type Node, type Pair, type YAMLMap } from "yaml";
import { sha256 } from "../domain/hash";
import type { BaseConflictDecision, BaseDocument, ChangeOperation, PropertyReference, SemanticKind, SourceSnapshot } from "../domain/types";
import { isDotPropertyName, replaceExactProperty, scanExpression, scanFormulaReferences } from "./expression-reference-adapter";

export const BASE_ADAPTER_VERSION = "bases-1.9-v1";

interface Context {
  filePath: string;
  references: PropertyReference[];
  formulaDefinitions: string[];
  formulaRoots: string[];
  formulaDependencies: Record<string, string[]>;
  unknownShapes: BaseDocument["unknownShapes"];
}

interface BaseTransformResult {
  afterText: string;
  afterHash: string;
  operations: ChangeOperation[];
  blockers: string[];
}

function pairKey(pair: Pair): string | undefined {
  return isScalar(pair.key) && typeof pair.key.value === "string" ? pair.key.value : undefined;
}

function asNode(value: unknown): Node | null | undefined {
  return value as Node | null | undefined;
}

function mapValue(map: YAMLMap, key: string): Node | null | undefined {
  return asNode(map.items.find((pair) => pairKey(pair) === key)?.value);
}

function evidence(value: string): string {
  return value.length <= 160 ? value : `${value.slice(0, 157)}...`;
}

function unknownShape(path: Array<string | number>, message: string, node?: Node | null): BaseDocument["unknownShapes"][number] {
  const searchText = node?.toString();
  return { path, evidence: message, ...(searchText ? { searchText } : {}) };
}

function preserveLineEndings(output: string, source: string): string {
  return source.includes("\r\n") ? output.replace(/(?<!\r)\n/g, "\r\n") : output;
}

async function addReference(context: Context, reference: Omit<PropertyReference, "id">): Promise<void> {
  context.references.push({ ...reference, id: (await sha256(`${reference.filePath}\0${reference.structuralPath.join("/")}\0${reference.propertyName}\0${reference.evidence}`)).slice(0, 20) });
}

async function scanExpressionScalar(node: Node, path: Array<string | number>, kind: SemanticKind, context: Context, formulaOwner?: string): Promise<void> {
  if (isScalar(node) && typeof node.value === "string") {
    for (const match of scanExpression(node.value)) {
      await addReference(context, {
        filePath: context.filePath, fileKind: "base", semanticKind: kind, structuralPath: path,
        syntaxForm: match.syntaxForm, propertyName: match.propertyName, confidence: match.confidence,
        range: { from: match.from, to: match.to }, evidence: evidence(match.evidence)
      });
    }
    const formulaReferences = scanFormulaReferences(node.value);
    if (formulaOwner) context.formulaDependencies[formulaOwner] = formulaReferences;
    else context.formulaRoots.push(...formulaReferences);
  }
}

async function scanFilterNode(node: Node | null | undefined, path: Array<string | number>, context: Context): Promise<void> {
  if (node === undefined) return;
  if (isScalar(node) && typeof node.value === "string") {
    await scanExpressionScalar(node, path, "base-filter", context);
    return;
  }
  if (isMap(node) && node.items.length === 1) {
    const pair = node.items[0];
    const key = pair ? pairKey(pair) : undefined;
    const children = pair ? asNode(pair.value) : undefined;
    if (key !== undefined && ["and", "or", "not"].includes(key) && isSeq(children)) {
      for (let index = 0; index < children.items.length; index += 1) await scanFilterNode(asNode(children.items[index]), [...path, key, index], context);
      return;
    }
  }
  context.unknownShapes.push(unknownShape(path, "filter must be an expression string or a single and/or/not array", node));
}

async function scanPropertyIds(node: Node | null | undefined, path: Array<string | number>, kind: SemanticKind, context: Context): Promise<void> {
  if (isScalar(node) && typeof node.value === "string") {
    if (node.value.startsWith("note.") && node.value.length > 5) {
      await addReference(context, {
        filePath: context.filePath, fileKind: "base", semanticKind: kind, structuralPath: path,
        syntaxForm: "serialized-property-id", propertyName: node.value.slice(5), confidence: "exact", evidence: node.value
      });
    }
    if (node.value.startsWith("formula.")) context.formulaRoots.push(node.value.slice(8));
    return;
  }
  if (isSeq(node)) {
    for (let index = 0; index < node.items.length; index += 1) {
      const item = node.items[index];
      if (isMap(item)) {
        for (const pair of item.items) {
          const key = pairKey(pair);
          if (["property", "field", "column"].includes(key ?? "")) await scanPropertyIds(asNode(pair.value), [...path, index, key ?? "property"], kind, context);
        }
      } else await scanPropertyIds(asNode(item), [...path, index], kind, context);
    }
    return;
  }
  if (isMap(node)) {
    for (const pair of node.items) {
      const key = pairKey(pair);
      if (key !== undefined) await scanPropertyIds(asNode(pair.value), [...path, key], kind, context);
    }
  }
}

async function scanBaseDocument(document: Document, context: Context): Promise<void> {
  if (!isMap(document.contents)) throw new Error("Base root must be a mapping.");
  const root = document.contents;
  const known = new Set(["filters", "properties", "formulas", "summaries", "views"]);
  for (const pair of root.items) {
    const key = pairKey(pair);
    if (key !== undefined && !known.has(key)) context.unknownShapes.push(unknownShape([key], `Unknown top-level field: ${key}`));
  }
  await scanFilterNode(mapValue(root, "filters"), ["filters"], context);
  const properties = mapValue(root, "properties");
  if (isMap(properties)) {
    for (const pair of properties.items) {
      const key = pairKey(pair);
      if (key?.startsWith("note.") && key.length > 5) await addReference(context, {
        filePath: context.filePath, fileKind: "base", semanticKind: "base-property-config", structuralPath: ["properties", key],
        syntaxForm: "serialized-property-id", propertyName: key.slice(5), confidence: "exact", evidence: key
      });
    }
  } else if (properties !== undefined) context.unknownShapes.push(unknownShape(["properties"], "properties must be a mapping", properties));
  for (const section of ["formulas", "summaries"] as const) {
    const node = mapValue(root, section);
    if (isMap(node)) {
      for (const pair of node.items) {
        const key = pairKey(pair);
        if (key !== undefined && section === "formulas") context.formulaDefinitions.push(key);
        const value = asNode(pair.value);
        if (key !== undefined && value !== undefined) {
          if (isScalar(value) && typeof value.value === "string") await scanExpressionScalar(
            value, [section, key], section === "formulas" ? "base-formula" : "base-summary", context,
            section === "formulas" ? key : undefined
          );
          else context.unknownShapes.push(unknownShape([section, key], `${section} values must be expression strings`, value));
        }
      }
    } else if (node !== undefined) context.unknownShapes.push(unknownShape([section], `${section} must be a mapping`, node));
  }
  const views = mapValue(root, "views");
  if (views === undefined) return;
  if (!isSeq(views)) {
    context.unknownShapes.push(unknownShape(["views"], "views must be a sequence", views));
    return;
  }
  for (let index = 0; index < views.items.length; index += 1) {
    const view = views.items[index];
    if (!isMap(view)) { context.unknownShapes.push(unknownShape(["views", index], "view must be a mapping", asNode(view))); continue; }
    await scanFilterNode(mapValue(view, "filters"), ["views", index, "filters"], context);
    await scanPropertyIds(mapValue(view, "order"), ["views", index, "order"], "view-order", context);
    await scanPropertyIds(mapValue(view, "sort"), ["views", index, "sort"], "view-sort", context);
    await scanPropertyIds(mapValue(view, "groupBy"), ["views", index, "groupBy"], "view-group", context);
  }
}

export async function parseBase(snapshot: SourceSnapshot): Promise<BaseDocument> {
  const context: Context = { filePath: snapshot.path, references: [], formulaDefinitions: [], formulaRoots: [], formulaDependencies: {}, unknownShapes: [] };
  try {
    const sourceText = snapshot.text.startsWith("\uFEFF") ? snapshot.text.slice(1) : snapshot.text;
    const document = parseDocument(sourceText, { keepSourceTokens: true, prettyErrors: false, strict: true, uniqueKeys: true });
    if (document.errors.length > 0) throw new Error(document.errors[0]?.message ?? "Invalid Base YAML");
    await scanBaseDocument(document, context);
    return { snapshot, ...context };
  } catch (error) {
    return { snapshot, ...context, parseError: error instanceof Error ? error.message : "Unknown Base YAML error" };
  }
}

function transformExpressionScalar(node: Node | null | undefined, oldName: string, newName: string, path: Array<string | number>, kind: SemanticKind, operations: ChangeOperation[]): void {
  if (isScalar(node) && typeof node.value === "string") {
    const result = replaceExactProperty(node.value, oldName, newName);
    if (result.replacements.length > 0) {
      node.value = result.text;
      for (const replacement of result.replacements) operations.push({ kind, structuralPath: path, before: replacement.evidence, after: `note.${newName}`, reason: `Update exact property reference in ${path.join(" > ")}` });
    }
    return;
  }
}

function transformFilterNode(node: Node | null | undefined, oldName: string, newName: string, path: Array<string | number>, operations: ChangeOperation[]): void {
  if (isScalar(node) && typeof node.value === "string") {
    transformExpressionScalar(node, oldName, newName, path, "base-filter", operations);
    return;
  }
  if (!isMap(node) || node.items.length !== 1) return;
  const pair = node.items[0];
  const key = pair ? pairKey(pair) : undefined;
  const children = pair ? asNode(pair.value) : undefined;
  if (key === undefined || !["and", "or", "not"].includes(key) || !isSeq(children)) return;
  children.items.forEach((item, index) => transformFilterNode(asNode(item), oldName, newName, [...path, key, index], operations));
}

function hasExactExpressionReference(node: Node | null | undefined, oldName: string): boolean {
  if (isScalar(node) && typeof node.value === "string") return scanExpression(node.value).some((match) => match.confidence === "exact" && match.propertyName === oldName);
  return false;
}

function hasExactFilterReference(node: Node | null | undefined, oldName: string): boolean {
  if (hasExactExpressionReference(node, oldName)) return true;
  if (!isMap(node) || node.items.length !== 1) return false;
  const pair = node.items[0];
  const key = pair ? pairKey(pair) : undefined;
  const children = pair ? asNode(pair.value) : undefined;
  return key !== undefined && ["and", "or", "not"].includes(key) && isSeq(children)
    ? children.items.some((item) => hasExactFilterReference(asNode(item), oldName))
    : false;
}

function transformPropertyIds(node: Node | null | undefined, oldId: string, newId: string, path: Array<string | number>, kind: SemanticKind, operations: ChangeOperation[]): void {
  if (isScalar(node) && node.value === oldId) {
    node.value = newId;
    operations.push({ kind, structuralPath: path, before: oldId, after: newId, reason: `Update property ID in ${path.join(" > ")}` });
  } else if (isSeq(node)) node.items.forEach((item, index) => transformPropertyIds(asNode(item), oldId, newId, [...path, index], kind, operations));
  else if (isMap(node)) node.items.forEach((pair) => { const key = pairKey(pair); if (["property", "field", "column"].includes(key ?? "")) transformPropertyIds(asNode(pair.value), oldId, newId, [...path, key ?? "property"], kind, operations); });
}

export async function renameBaseReferences(text: string, oldName: string, newName: string, decision: BaseConflictDecision): Promise<BaseTransformResult> {
  const operations: ChangeOperation[] = [];
  const blockers: string[] = [];
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const sourceText = bom ? text.slice(1) : text;
  const document = parseDocument(sourceText, { keepSourceTokens: true, prettyErrors: false, strict: true, uniqueKeys: true });
  if (document.errors.length > 0 || !isMap(document.contents)) {
    blockers.push(document.errors[0]?.message ?? "Base root must be a mapping.");
    return { afterText: text, afterHash: await sha256(text), operations, blockers };
  }
  const root = document.contents;
  const expressionScalars: Array<Node | null | undefined> = [];
  for (const section of ["formulas", "summaries"] as const) {
    const sectionNode = mapValue(root, section);
    if (isMap(sectionNode)) sectionNode.items.forEach((pair) => expressionScalars.push(asNode(pair.value)));
  }
  const viewsForValidation = mapValue(root, "views");
  const filterRoots: Array<Node | null | undefined> = [mapValue(root, "filters")];
  if (isSeq(viewsForValidation)) for (const view of viewsForValidation.items) if (isMap(view)) filterRoots.push(mapValue(view, "filters"));
  if (!isDotPropertyName(newName) && (expressionScalars.some((node) => hasExactExpressionReference(node, oldName)) || filterRoots.some((node) => hasExactFilterReference(node, oldName)))) {
    blockers.push(`Property '${newName}' has no verified dot-access expression syntax. Expression references require manual review.`);
    return { afterText: text, afterHash: await sha256(text), operations, blockers };
  }
  transformFilterNode(mapValue(root, "filters"), oldName, newName, ["filters"], operations);
  for (const section of ["formulas", "summaries"] as const) {
    const node = mapValue(root, section);
    if (isMap(node)) node.items.forEach((pair) => {
      const key = pairKey(pair);
      const value = asNode(pair.value);
      if (key !== undefined && isScalar(value) && typeof value.value === "string") transformExpressionScalar(value, oldName, newName, [section, key], section === "formulas" ? "base-formula" : "base-summary", operations);
    });
  }
  const properties = mapValue(root, "properties");
  const oldId = `note.${oldName}`;
  const newId = `note.${newName}`;
  if (isMap(properties)) {
    const sourceIndex = properties.items.findIndex((pair) => pairKey(pair) === oldId);
    const targetIndex = properties.items.findIndex((pair) => pairKey(pair) === newId);
    if (sourceIndex >= 0 && targetIndex >= 0) {
      if (decision === "block") blockers.push(`Both ${oldId} and ${newId} property configurations exist.`);
      else if (decision === "keep-target") properties.items.splice(sourceIndex, 1);
      else {
        const source = properties.items[sourceIndex];
        const target = properties.items[targetIndex];
        if (source && target) target.value = source.value;
        properties.items.splice(sourceIndex, 1);
      }
    } else if (sourceIndex >= 0) {
      const pair = properties.items[sourceIndex];
      if (pair?.key instanceof Scalar) pair.key.value = newId;
    }
    if (sourceIndex >= 0 && blockers.length === 0) operations.push({ kind: "base-property-config", structuralPath: ["properties", oldId], before: oldId, after: newId, reason: "Rename property display configuration" });
  }
  const views = mapValue(root, "views");
  if (isSeq(views)) views.items.forEach((view, index) => {
    if (!isMap(view)) return;
    transformFilterNode(mapValue(view, "filters"), oldName, newName, ["views", index, "filters"], operations);
    transformPropertyIds(mapValue(view, "order"), oldId, newId, ["views", index, "order"], "view-order", operations);
    transformPropertyIds(mapValue(view, "sort"), oldId, newId, ["views", index, "sort"], "view-sort", operations);
    transformPropertyIds(mapValue(view, "groupBy"), oldId, newId, ["views", index, "groupBy"], "view-group", operations);
  });
  if (blockers.length > 0) return { afterText: text, afterHash: await sha256(text), operations: [], blockers };
  const afterText = `${bom}${preserveLineEndings(document.toString({ lineWidth: 0 }), sourceText)}`;
  return { afterText, afterHash: await sha256(afterText), operations, blockers };
}
