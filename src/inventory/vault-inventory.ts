import type { TFile, Vault } from "obsidian";
import { parseBase } from "../adapters/bases-config-adapter";
import { parseMarkdown } from "../adapters/markdown-frontmatter-adapter";
import { sha256, stableStringify } from "../domain/hash";
import type { InventoryResult, ScanProgress, SourceSnapshot, ValueKind } from "../domain/types";

export interface InventoryOptions {
  signal?: AbortSignal;
  concurrency?: number;
  onProgress?: (progress: ScanProgress) => void;
}

export class VaultInventory {
  constructor(private readonly vault: Vault) {}

  async scan(options: InventoryOptions = {}): Promise<InventoryResult> {
    const files = this.vault.getFiles().filter((file) => file.extension === "md" || file.extension === "base").sort((a, b) => a.path.localeCompare(b.path));
    const snapshots: SourceSnapshot[] = [];
    const markdown: InventoryResult["markdown"] = [];
    const bases: InventoryResult["bases"] = [];
    const errors: InventoryResult["errors"] = [];
    const propertyTypes = new Map<string, Set<ValueKind>>();
    let cursor = 0;
    let processed = 0;
    let definitions = 0;
    let exactReferences = 0;
    const worker = async (): Promise<void> => {
      while (cursor < files.length) {
        options.signal?.throwIfAborted();
        const file = files[cursor++];
        if (!file) return;
        try {
          const text = await this.vault.cachedRead(file);
          const snapshot = await createSnapshot(file, text);
          if (snapshot.kind === "markdown") {
            const parsed = await parseMarkdown(snapshot);
            const metadataSnapshot = { ...snapshot, text: "" };
            snapshots.push(metadataSnapshot);
            markdown.push({ ...parsed, snapshot: metadataSnapshot });
            definitions += parsed.properties.size;
            if (parsed.parseError) errors.push({ path: file.path, message: parsed.parseError });
            for (const [name, kind] of parsed.properties) {
              const kinds = propertyTypes.get(name) ?? new Set<ValueKind>();
              kinds.add(kind);
              propertyTypes.set(name, kinds);
            }
          } else {
            snapshots.push(snapshot);
            const parsed = await parseBase(snapshot);
            bases.push(parsed);
            exactReferences += parsed.references.filter((reference) => reference.confidence === "exact").length;
            if (parsed.parseError) errors.push({ path: file.path, message: parsed.parseError });
          }
        } catch (error) {
          errors.push({ path: file.path, message: error instanceof Error ? error.message : "Unknown read error" });
        }
        processed += 1;
        options.onProgress?.({ processed, total: files.length, definitions, exactReferences, warnings: errors.length });
        if (processed % 25 === 0) await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
      }
    };
    await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 8, Math.max(1, files.length)) }, worker));
    snapshots.sort((a, b) => a.path.localeCompare(b.path));
    markdown.sort((a, b) => a.snapshot.path.localeCompare(b.snapshot.path));
    bases.sort((a, b) => a.snapshot.path.localeCompare(b.snapshot.path));
    const references = bases.flatMap((base) => base.references).sort((a, b) => a.id.localeCompare(b.id));
    const revision = await sha256(stableStringify(snapshots.map(({ path, contentHash }) => ({ path, contentHash }))));
    return { revision, snapshots, markdown, bases, propertyTypes, references, errors };
  }
}

async function createSnapshot(file: TFile, text: string): Promise<SourceSnapshot> {
  return { path: file.path, kind: file.extension === "md" ? "markdown" : "base", text, contentHash: await sha256(text), mtime: file.stat.mtime, size: file.stat.size };
}
