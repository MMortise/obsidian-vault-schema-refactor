import { diffLines, diffWordsWithSpace, type Change } from "diff";
import type { FileChange } from "../domain/types";

export interface DiffChunk {
  value: string;
  added: boolean;
  removed: boolean;
  count: number;
}

function normalize(changes: Change[]): DiffChunk[] {
  return changes.map((change) => ({ value: change.value, added: change.added, removed: change.removed, count: change.count }));
}

export function buildLineDiff(change: Pick<FileChange, "beforeText" | "afterText">): DiffChunk[] {
  return normalize(diffLines(change.beforeText, change.afterText));
}

export function buildWordDiff(before: string, after: string): DiffChunk[] {
  return normalize(diffWordsWithSpace(before, after));
}

export function diffSummary(change: Pick<FileChange, "beforeText" | "afterText">): { additions: number; deletions: number } {
  return buildLineDiff(change).reduce((summary, chunk) => ({
    additions: summary.additions + (chunk.added ? chunk.count : 0),
    deletions: summary.deletions + (chunk.removed ? chunk.count : 0)
  }), { additions: 0, deletions: 0 });
}
