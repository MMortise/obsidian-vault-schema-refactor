import { isMap, parseDocument, Scalar, type Document, type Pair } from "yaml";
import { sha256, stableStringify } from "../domain/hash";
import type { ChangeOperation, ConflictDecision, MarkdownDocument, SourceSnapshot, ValueKind } from "../domain/types";

export interface MarkdownTransformResult {
  afterText: string;
  afterHash: string;
  operations: ChangeOperation[];
  blockers: string[];
}

interface FrontmatterSlice {
  bom: string;
  opening: string;
  yaml: string;
  closing: string;
  body: string;
}

function splitFrontmatter(text: string): FrontmatterSlice | undefined {
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const content = bom ? text.slice(1) : text;
  const openingMatch = /^(---[ \t]*\r?\n)/.exec(content);
  if (!openingMatch) return undefined;
  const yamlStart = openingMatch[0].length;
  const closingMatch = /^(---|\.\.\.)[ \t]*(\r?\n|$)/m.exec(content.slice(yamlStart));
  if (!closingMatch) return undefined;
  const closeStart = yamlStart + closingMatch.index;
  const closeEnd = closeStart + closingMatch[0].length;
  return {
    bom,
    opening: content.slice(0, yamlStart),
    yaml: content.slice(yamlStart, closeStart),
    closing: content.slice(closeStart, closeEnd),
    body: content.slice(closeEnd)
  };
}

function valueKind(value: unknown): ValueKind {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "list";
  switch (typeof value) {
    case "string": return "string";
    case "number": return "number";
    case "boolean": return "boolean";
    default: return "object";
  }
}

function parseYamlMap(yaml: string): Document {
  return parseDocument(yaml, { keepSourceTokens: true, prettyErrors: false, strict: true, uniqueKeys: true });
}

function preserveLineEndings(output: string, source: string): string {
  return source.includes("\r\n") ? output.replace(/(?<!\r)\n/g, "\r\n") : output;
}

function scalarKey(pair: Pair): string | undefined {
  return pair.key instanceof Scalar && typeof pair.key.value === "string" ? pair.key.value : undefined;
}

function nodeValue(value: unknown): unknown {
  return value !== null && typeof value === "object" && "toJSON" in value && typeof (value as { toJSON?: unknown }).toJSON === "function"
    ? (value as { toJSON: () => unknown }).toJSON()
    : value;
}

export function parseMarkdown(snapshot: SourceSnapshot): Promise<MarkdownDocument> {
  const properties = new Map<string, ValueKind>();
  const slice = splitFrontmatter(snapshot.text);
  if (!slice) return Promise.resolve({ snapshot, properties });
  try {
    const document = parseYamlMap(slice.yaml);
    if (document.errors.length > 0) throw new Error(document.errors[0]?.message ?? "Invalid Frontmatter YAML");
    if (document.contents !== null && !isMap(document.contents)) throw new Error("Frontmatter root must be a mapping.");
    if (isMap(document.contents)) {
      for (const pair of document.contents.items) {
        const key = scalarKey(pair);
        if (key !== undefined) properties.set(key, valueKind(nodeValue(pair.value)));
      }
    }
    return Promise.resolve({ snapshot, properties });
  } catch (error) {
    return Promise.resolve({ snapshot, properties, parseError: error instanceof Error ? error.message : "Unknown YAML error" });
  }
}

function mergeLists(target: unknown[], source: unknown[]): unknown[] {
  const merged = [...target];
  for (const item of source) {
    const fingerprint = stableStringify(item);
    if (!merged.some((existing) => stableStringify(existing) === fingerprint)) merged.push(item);
  }
  return merged;
}

export async function renameFrontmatterKey(
  text: string,
  oldName: string,
  newName: string,
  decision: ConflictDecision
): Promise<MarkdownTransformResult> {
  const blockers: string[] = [];
  const operations: ChangeOperation[] = [];
  const slice = splitFrontmatter(text);
  if (!slice) return { afterText: text, afterHash: await sha256(text), operations, blockers };
  const document = parseYamlMap(slice.yaml);
  if (document.errors.length > 0 || !isMap(document.contents)) {
    blockers.push(document.errors[0]?.message ?? "Frontmatter root is not a mapping.");
    return { afterText: text, afterHash: await sha256(text), operations, blockers };
  }
  const map = document.contents;
  const sourceIndex = map.items.findIndex((pair) => scalarKey(pair) === oldName);
  const targetIndex = map.items.findIndex((pair) => scalarKey(pair) === newName);
  if (sourceIndex < 0) return { afterText: text, afterHash: await sha256(text), operations, blockers };

  const sourcePair = map.items[sourceIndex];
  if (!sourcePair) return { afterText: text, afterHash: await sha256(text), operations, blockers };
  if (targetIndex >= 0 && targetIndex !== sourceIndex) {
    if (decision === "block") blockers.push(`Both ${oldName} and ${newName} exist.`);
    else if (decision === "keep-target") map.items.splice(sourceIndex, 1);
    else if (decision === "keep-source") {
      const targetPair = map.items[targetIndex];
      if (targetPair) targetPair.value = sourcePair.value;
      map.items.splice(sourceIndex, 1);
    } else {
      const targetPair = map.items[targetIndex];
      const targetValue = nodeValue(targetPair?.value);
      const sourceValue = nodeValue(sourcePair.value);
      if (!Array.isArray(targetValue) || !Array.isArray(sourceValue) || !targetPair) blockers.push("Merge lists requires both values to be lists.");
      else {
        targetPair.value = document.createNode(mergeLists(targetValue, sourceValue));
        map.items.splice(sourceIndex, 1);
      }
    }
  } else if (sourcePair.key instanceof Scalar) {
    sourcePair.key.value = newName;
    if (/^(?:true|false|null|yes|no|on|off|[-+]?\d)/i.test(newName) || /[:#[\]{},&*!|>'"%@`]/.test(newName)) {
      sourcePair.key.type = Scalar.QUOTE_DOUBLE;
    }
  }
  if (blockers.length > 0) return { afterText: text, afterHash: await sha256(text), operations, blockers };
  operations.push({ kind: "frontmatter-key", structuralPath: [oldName], before: oldName, after: newName, reason: `Rename top-level property ${oldName} to ${newName}` });
  const yaml = preserveLineEndings(document.toString({ lineWidth: 0 }), slice.yaml);
  const afterText = `${slice.bom}${slice.opening}${yaml}${slice.closing}${slice.body}`;
  return { afterText, afterHash: await sha256(afterText), operations, blockers };
}
