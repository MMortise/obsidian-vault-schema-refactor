import { Notice, Plugin, setTooltip, type Command } from "obsidian";
import { SchemaRefactorService } from "./app/schema-refactor-service";
import { createTranslator, normalizeLanguage, type Language } from "./i18n";
import { DEFAULT_SETTINGS, SchemaRefactorSettingTab, type SchemaRefactorSettings } from "./settings";
import { SCHEMA_REFACTOR_VIEW, SchemaRefactorView } from "./ui/main-view";

export default class SchemaRefactorPlugin extends Plugin {
  settings: SchemaRefactorSettings = DEFAULT_SETTINGS;
  service!: SchemaRefactorService;
  private ribbonIcon: HTMLElement | undefined;
  private openCommand: Command | undefined;
  private doctorCommand: Command | undefined;

  async onload(): Promise<void> {
    await this.loadSettings();
    const t = createTranslator(this.settings.language);
    this.service = new SchemaRefactorService(this.app, this.manifest.id, () => this.settings);
    this.registerView(SCHEMA_REFACTOR_VIEW, (leaf) => new SchemaRefactorView(leaf, this));
    this.ribbonIcon = this.addRibbonIcon("scan-search", t("openApp"), () => void this.activateView());
    this.openCommand = this.addCommand({ id: "open-schema-refactor", name: t("openApp"), callback: () => void this.activateView() });
    this.doctorCommand = this.addCommand({ id: "run-doctor", name: t("runDoctorCommand"), callback: () => void this.runDoctor() });
    this.addSettingTab(new SchemaRefactorSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => void this.recoverAndOptionallyScan());
  }

  onunload(): void { this.app.workspace.detachLeavesOfType(SCHEMA_REFACTOR_VIEW); }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<SchemaRefactorSettings> | null);
    this.settings.language = normalizeLanguage(this.settings.language);
  }
  async saveSettings(): Promise<void> { await this.saveData(this.settings); }

  async setLanguage(language: Language): Promise<void> {
    this.settings.language = language;
    await this.saveSettings();
    const t = createTranslator(language);
    if (this.ribbonIcon) setTooltip(this.ribbonIcon, t("openApp"));
    if (this.openCommand) this.openCommand.name = t("openApp");
    if (this.doctorCommand) this.doctorCommand.name = t("runDoctorCommand");
    for (const leaf of this.app.workspace.getLeavesOfType(SCHEMA_REFACTOR_VIEW)) {
      if (leaf.view instanceof SchemaRefactorView) leaf.view.refreshLanguage();
    }
  }

  async activateView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(SCHEMA_REFACTOR_VIEW)[0];
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true); await leaf.setViewState({ type: SCHEMA_REFACTOR_VIEW, active: true }); }
    await this.app.workspace.revealLeaf(leaf);
  }

  private async runDoctor(): Promise<void> {
    await this.activateView();
    const findings = await this.service.doctor();
    new Notice(createTranslator(this.settings.language)("doctorFound", { count: findings.length }));
  }

  private async recoverAndOptionallyScan(): Promise<void> {
    if (this.service.canWrite) {
      const incomplete = (await this.service.history()).filter((transaction) => !["COMPLETED", "ROLLED_BACK", "ROLLBACK_INCOMPLETE", "CANCELLED"].includes(transaction.state));
      if (incomplete.length > 0) {
        const t = createTranslator(this.settings.language);
        new Notice(incomplete.length === 1 ? t("interruptedTransaction") : t("interruptedTransactions", { count: incomplete.length }), 10000);
        await this.activateView();
      }
    }
    await this.service.pruneHistory(this.settings.snapshotRetention);
    if (this.settings.scanOnStartup) await this.service.doctor();
  }
}
