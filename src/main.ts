import { Notice, Plugin } from "obsidian";
import { SchemaRefactorService } from "./app/schema-refactor-service";
import { DEFAULT_SETTINGS, SchemaRefactorSettingTab, type SchemaRefactorSettings } from "./settings";
import { SCHEMA_REFACTOR_VIEW, SchemaRefactorView } from "./ui/main-view";

export default class SchemaRefactorPlugin extends Plugin {
  settings: SchemaRefactorSettings = DEFAULT_SETTINGS;
  service!: SchemaRefactorService;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.service = new SchemaRefactorService(this.app, this.manifest.id, () => this.settings);
    this.registerView(SCHEMA_REFACTOR_VIEW, (leaf) => new SchemaRefactorView(leaf, this));
    this.addRibbonIcon("scan-search", "Open Schema Refactor", () => void this.activateView());
    this.addCommand({ id: "open-schema-refactor", name: "Open Schema Refactor", callback: () => void this.activateView() });
    this.addCommand({ id: "run-doctor", name: "Run read-only Doctor scan", callback: () => void this.runDoctor() });
    this.addSettingTab(new SchemaRefactorSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => void this.recoverAndOptionallyScan());
  }

  onunload(): void { this.app.workspace.detachLeavesOfType(SCHEMA_REFACTOR_VIEW); }

  async loadSettings(): Promise<void> { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<SchemaRefactorSettings> | null); }
  async saveSettings(): Promise<void> { await this.saveData(this.settings); }

  async activateView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(SCHEMA_REFACTOR_VIEW)[0];
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true); await leaf.setViewState({ type: SCHEMA_REFACTOR_VIEW, active: true }); }
    await this.app.workspace.revealLeaf(leaf);
  }

  private async runDoctor(): Promise<void> {
    await this.activateView();
    const findings = await this.service.doctor();
    new Notice(`Schema Refactor Doctor found ${findings.length} items.`);
  }

  private async recoverAndOptionallyScan(): Promise<void> {
    if (this.service.canWrite) {
      const incomplete = (await this.service.history()).filter((transaction) => !["COMPLETED", "ROLLED_BACK", "ROLLBACK_INCOMPLETE", "CANCELLED"].includes(transaction.state));
      if (incomplete.length > 0) {
        new Notice(`${incomplete.length} interrupted Schema Refactor transaction${incomplete.length === 1 ? "" : "s"} need review. No recovery writes have started.`, 10000);
        await this.activateView();
      }
    }
    await this.service.pruneHistory(this.settings.snapshotRetention);
    if (this.settings.scanOnStartup) await this.service.doctor();
  }
}
