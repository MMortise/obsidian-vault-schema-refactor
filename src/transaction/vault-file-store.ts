import type { Vault } from "obsidian";
import { TFile } from "obsidian";
import type { TransactionFileStore } from "./types";

export class VaultFileStore implements TransactionFileStore {
  constructor(private readonly vault: Vault) {}

  async read(path: string): Promise<string> {
    const file = this.resolve(path);
    return this.vault.read(file);
  }

  async write(path: string, text: string): Promise<void> {
    const file = this.resolve(path);
    await this.vault.modify(file, text);
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.vault.getAbstractFileByPath(path) instanceof TFile);
  }

  private resolve(path: string): TFile {
    const file = this.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.path !== path) throw new Error(`Vault file is missing: ${path}`);
    return file;
  }
}
