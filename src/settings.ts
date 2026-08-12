import { App, PluginSettingTab, Setting } from "obsidian";
import type SchemaRefactorPlugin from "./main";

export interface SchemaRefactorSettings {
  snapshotRetention: number;
  scanOnStartup: boolean;
  showTextMatches: boolean;
  lowResourceMode: boolean;
  includeTypeStats: boolean;
}

export const DEFAULT_SETTINGS: SchemaRefactorSettings = {
  snapshotRetention: 20,
  scanOnStartup: false,
  showTextMatches: false,
  lowResourceMode: false,
  includeTypeStats: true
};

export class SchemaRefactorSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: SchemaRefactorPlugin) { super(app, plugin); }

  display(): void {
    this.containerEl.empty();
    this.containerEl.createEl("h2", { text: "Schema Refactor" });
    new Setting(this.containerEl).setName("Snapshot retention").setDesc("Number of completed transactions to retain. Incomplete rollbacks are never cleaned automatically.").addSlider((slider) => slider.setLimits(1, 100, 1).setValue(this.plugin.settings.snapshotRetention).onChange(async (value) => { this.plugin.settings.snapshotRetention = value; await this.plugin.saveSettings(); }));
    new Setting(this.containerEl).setName("Scan after startup").setDesc("Run a delayed, read-only Doctor scan when Obsidian starts.").addToggle((toggle) => toggle.setValue(this.plugin.settings.scanOnStartup).onChange(async (value) => { this.plugin.settings.scanOnStartup = value; await this.plugin.saveSettings(); }));
    new Setting(this.containerEl).setName("Show text matches").setDesc("Include low-confidence text matches in scan results. They are never changed automatically.").addToggle((toggle) => toggle.setValue(this.plugin.settings.showTextMatches).onChange(async (value) => { this.plugin.settings.showTextMatches = value; await this.plugin.saveSettings(); }));
    new Setting(this.containerEl).setName("Low resource mode").setDesc("Use lower scan concurrency on large or resource-constrained devices.").addToggle((toggle) => toggle.setValue(this.plugin.settings.lowResourceMode).onChange(async (value) => { this.plugin.settings.lowResourceMode = value; await this.plugin.saveSettings(); }));
    new Setting(this.containerEl).setName("Include type statistics in JSON reports").setDesc("Reports include only type names, never property values.").addToggle((toggle) => toggle.setValue(this.plugin.settings.includeTypeStats).onChange(async (value) => { this.plugin.settings.includeTypeStats = value; await this.plugin.saveSettings(); }));
    this.containerEl.createEl("p", { cls: "setting-item-description", text: `Snapshots are stored under ${this.app.vault.configDir}/plugins/schema-refactor/snapshots. Schema Refactor does not send Vault data over the network.` });
  }
}
