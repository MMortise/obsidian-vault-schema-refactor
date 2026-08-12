import { App, PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import { createTranslator, normalizeLanguage, type Language } from "./i18n";
import type SchemaRefactorPlugin from "./main";

const REPOSITORY_URL = "https://github.com/MMortise/obsidian-vault-schema-refactor";

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
  constructor(app: App, private readonly schemaPlugin: SchemaRefactorPlugin) { super(app, schemaPlugin); }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const t = createTranslator(this.schemaPlugin.settings.language);
    return [
      {
        name: t("language"),
        control: { type: "dropdown", key: "language", options: { en: t("english"), "zh-CN": t("simplifiedChinese") } }
      },
      {
        name: t("snapshotRetention"),
        desc: t("snapshotRetentionHint"),
        control: { type: "slider", key: "snapshotRetention", min: 1, max: 100, step: 1, displayFormat: String }
      },
      {
        name: t("scanAfterStartup"),
        desc: t("scanAfterStartupHint"),
        control: { type: "toggle", key: "scanOnStartup" }
      },
      {
        name: t("showTextMatches"),
        desc: t("showTextMatchesHint"),
        control: { type: "toggle", key: "showTextMatches" }
      },
      {
        name: t("lowResourceMode"),
        desc: t("lowResourceModeHint"),
        control: { type: "toggle", key: "lowResourceMode" }
      },
      {
        name: t("includeTypeStats"),
        desc: t("includeTypeStatsHint"),
        control: { type: "toggle", key: "includeTypeStats" }
      },
      {
        name: t("privacy"),
        desc: t("snapshotPrivacy", { path: `${this.app.vault.configDir}/plugins/schema-refactor/snapshots` })
      },
      {
        name: t("repository"),
        render: (setting) => {
          setting.descEl.createEl("a", { text: REPOSITORY_URL, href: REPOSITORY_URL, attr: { target: "_blank", rel: "noopener" } });
        }
      }
    ];
  }

  getControlValue(key: string): unknown {
    return this.schemaPlugin.settings[key as keyof SchemaRefactorSettings];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "language") {
      const saved = this.schemaPlugin.setLanguage(normalizeLanguage(value));
      this.update();
      await saved;
      return;
    }
    switch (key) {
      case "snapshotRetention": this.schemaPlugin.settings.snapshotRetention = Number(value); break;
      case "scanOnStartup": this.schemaPlugin.settings.scanOnStartup = Boolean(value); break;
      case "showTextMatches": this.schemaPlugin.settings.showTextMatches = Boolean(value); break;
      case "lowResourceMode": this.schemaPlugin.settings.lowResourceMode = Boolean(value); break;
      case "includeTypeStats": this.schemaPlugin.settings.includeTypeStats = Boolean(value); break;
      default: return;
    }
    await this.schemaPlugin.saveSettings();
  }
}
