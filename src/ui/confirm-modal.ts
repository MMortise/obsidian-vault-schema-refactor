import { Modal, setIcon } from "obsidian";
import type { ChangePlan } from "../domain/types";
import { createTranslator, type Translate } from "../i18n";
import { buildConfirmationSummary } from "./confirmation-summary";

export class ConfirmApplyModal extends Modal {
  constructor(app: ConstructorParameters<typeof Modal>[0], private readonly plan: ChangePlan, private readonly onConfirm: () => void, private readonly t: Translate = createTranslator("en")) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    const summary = buildConfirmationSummary(this.plan, this.t);
    contentEl.addClass("schema-refactor-confirm");
    this.setTitle(this.t("confirmTitle"));
    const facts = contentEl.createDiv({ cls: "schema-refactor-confirm__facts" });
    facts.createDiv({ text: this.t("filesWillChange", { count: summary.filesChanging }) });
    facts.createDiv({ text: this.t("excludedAndRetained", { files: summary.excludedFiles, references: summary.retainedReferences }) });
    facts.createDiv({ text: this.t("conflictPolicy", { policy: summary.conflictPolicy }) });
    facts.createDiv({ text: this.t("snapshotFirst") });
    contentEl.createEl("p", { text: this.t("externalEditWarning") });
    const actions = contentEl.createDiv({ cls: "modal-button-container" });
    actions.createEl("button", { text: this.t("cancel") }).addEventListener("click", () => this.close());
    const confirm = actions.createEl("button", { cls: "mod-cta" });
    setIcon(confirm, "play");
    confirm.createSpan({ text: this.t("applyChanges") });
    confirm.addEventListener("click", () => { this.close(); this.onConfirm(); });
  }

  onClose(): void { this.contentEl.empty(); }
}
