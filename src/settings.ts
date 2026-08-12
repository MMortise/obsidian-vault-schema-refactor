import { App, PluginSettingTab, Setting } from "obsidian";
import { createTranslator, normalizeLanguage, type Language } from "./i18n";
import type SchemaRefactorPlugin from "./main";

export interface SchemaRefactorSettings {
  language: Language;
  snapshotRetention: number;
  scanOnStartup: boolean;
  showTextMatches: boolean;
  lowResourceMode: boolean;
  includeTypeStats: boolean;
}

export const DEFAULT_SETTINGS: SchemaRefactorSettings = {
  language: "en",
  snapshotRetention: 20,
  scanOnStartup: false,
  showTextMatches: false,
  lowResourceMode: false,
  includeTypeStats: true
};

export class SchemaRefactorSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: SchemaRefactorPlugin) { super(app, plugin); }

  display(): void {
    this.renderSettings();
  }

  private renderSettings(): void {
    const t = createTranslator(this.plugin.settings.language);
    this.containerEl.empty();
    this.containerEl.createEl("h2", { text: t("appName") });
    new Setting(this.containerEl).setName(t("language")).addDropdown((dropdown) => dropdown
      .addOption("en", t("english"))
      .addOption("zh-CN", t("simplifiedChinese"))
      .setValue(this.plugin.settings.language)
      .onChange(async (value) => { await this.plugin.setLanguage(normalizeLanguage(value)); this.renderSettings(); }));
    new Setting(this.containerEl).setName(t("snapshotRetention")).setDesc(t("snapshotRetentionHint")).addSlider((slider) => slider.setLimits(1, 100, 1).setValue(this.plugin.settings.snapshotRetention).onChange(async (value) => { this.plugin.settings.snapshotRetention = value; await this.plugin.saveSettings(); }));
    new Setting(this.containerEl).setName(t("scanAfterStartup")).setDesc(t("scanAfterStartupHint")).addToggle((toggle) => toggle.setValue(this.plugin.settings.scanOnStartup).onChange(async (value) => { this.plugin.settings.scanOnStartup = value; await this.plugin.saveSettings(); }));
    new Setting(this.containerEl).setName(t("showTextMatches")).setDesc(t("showTextMatchesHint")).addToggle((toggle) => toggle.setValue(this.plugin.settings.showTextMatches).onChange(async (value) => { this.plugin.settings.showTextMatches = value; await this.plugin.saveSettings(); }));
    new Setting(this.containerEl).setName(t("lowResourceMode")).setDesc(t("lowResourceModeHint")).addToggle((toggle) => toggle.setValue(this.plugin.settings.lowResourceMode).onChange(async (value) => { this.plugin.settings.lowResourceMode = value; await this.plugin.saveSettings(); }));
    new Setting(this.containerEl).setName(t("includeTypeStats")).setDesc(t("includeTypeStatsHint")).addToggle((toggle) => toggle.setValue(this.plugin.settings.includeTypeStats).onChange(async (value) => { this.plugin.settings.includeTypeStats = value; await this.plugin.saveSettings(); }));
    this.containerEl.createEl("p", { cls: "setting-item-description", text: t("snapshotPrivacy", { path: `${this.app.vault.configDir}/plugins/schema-refactor/snapshots` }) });
  }
}
