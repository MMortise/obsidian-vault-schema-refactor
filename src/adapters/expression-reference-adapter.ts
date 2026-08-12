import type { Confidence } from "../domain/types";

export interface ExpressionMatch {
  propertyName: string;
  confidence: Confidence;
  syntaxForm: "note-prefixed" | "bare-identifier";
  from: number;
  to: number;
  evidence: string;
}

const identifierStart = /[\p{L}_$]/u;
const identifierPart = /[\p{L}\p{M}\p{N}_$]/u;

function isBoundary(value: string | undefined): boolean {
  return value === undefined || !identifierPart.test(value);
}

function isPropertyTerminator(value: string | undefined): boolean {
  return isBoundary(value) && value !== "." && value !== "[" && value !== "(" && value !== "-";
}

export function isDotPropertyName(value: string): boolean {
  return /^[\p{L}_$][\p{L}\p{M}\p{N}_$]*$/u.test(value);
}

function skipLiteralOrComment(expression: string, index: number): number | undefined {
  if (expression.startsWith("//", index)) {
    const newline = expression.indexOf("\n", index + 2);
    return newline < 0 ? expression.length : newline + 1;
  }
  if (expression.startsWith("/*", index)) {
    const closing = expression.indexOf("*/", index + 2);
    return closing < 0 ? expression.length : closing + 2;
  }
  const character = expression[index];
  if (character === '"' || character === "'") {
    const quote = character;
    index += 1;
    while (index < expression.length) {
      if (expression[index] === "\\") index += 2;
      else if (expression[index] === quote) return index + 1;
      else index += 1;
    }
    return expression.length;
  }
  if (character === "/") {
    let previousIndex = index - 1;
    while (previousIndex >= 0 && /\s/.test(expression[previousIndex] ?? "")) previousIndex -= 1;
    const previous = expression[previousIndex];
    if (previous === undefined || /[=(,:!&|?+*%^<>[\]-]/.test(previous)) {
      index += 1;
      while (index < expression.length) {
        if (expression[index] === "\\") index += 2;
        else if (expression[index] === "/") return index + 1;
        else index += 1;
      }
      return expression.length;
    }
  }
  return undefined;
}

export function scanExpression(expression: string): ExpressionMatch[] {
  const matches: ExpressionMatch[] = [];
  let index = 0;
  while (index < expression.length) {
    const skipped = skipLiteralOrComment(expression, index);
    if (skipped !== undefined) { index = skipped; continue; }
    const character = expression[index];
    if (expression.startsWith("note.", index) && isBoundary(expression[index - 1])) {
      const nameStart = index + 5;
      let end = nameStart;
      while (end < expression.length && identifierPart.test(expression[end] ?? "")) end += 1;
      if (end > nameStart && isPropertyTerminator(expression[end])) {
        matches.push({
          propertyName: expression.slice(nameStart, end), confidence: "exact", syntaxForm: "note-prefixed",
          from: nameStart, to: end, evidence: expression.slice(index, end)
        });
        index = end;
        continue;
      }
    }
    if (character !== undefined && identifierStart.test(character)) {
      const start = index;
      index += 1;
      while (index < expression.length && identifierPart.test(expression[index] ?? "")) index += 1;
      const name = expression.slice(start, index);
      const previous = expression[start - 1];
      const next = expression[index];
      if (previous !== "." && next !== "." && next !== "(") {
        matches.push({ propertyName: name, confidence: "probable", syntaxForm: "bare-identifier", from: start, to: index, evidence: name });
      }
      continue;
    }
    index += 1;
  }
  return matches;
}

export function scanFormulaReferences(expression: string): string[] {
  const references: string[] = [];
  let index = 0;
  while (index < expression.length) {
    const skipped = skipLiteralOrComment(expression, index);
    if (skipped !== undefined) { index = skipped; continue; }
    if (expression.startsWith("formula.", index) && isBoundary(expression[index - 1])) {
      const nameStart = index + 8;
      let end = nameStart;
      while (end < expression.length && identifierPart.test(expression[end] ?? "")) end += 1;
      if (end > nameStart && isPropertyTerminator(expression[end])) {
        references.push(expression.slice(nameStart, end));
        index = end;
        continue;
      }
    }
    index += 1;
  }
  return references;
}

export function replaceExactProperty(expression: string, oldName: string, newName: string): { text: string; replacements: ExpressionMatch[] } {
  const replacements = scanExpression(expression).filter((match) => match.confidence === "exact" && match.propertyName === oldName);
  let text = expression;
  for (const match of [...replacements].sort((a, b) => b.from - a.from)) {
    text = `${text.slice(0, match.from)}${newName}${text.slice(match.to)}`;
  }
  return { text, replacements };
}
