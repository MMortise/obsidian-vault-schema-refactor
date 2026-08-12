import { Modal, setIcon } from "obsidian";
import { createTranslator, type Translate } from "../i18n";
import type { TransactionState } from "../transaction/types";
import { ApplyProgressState } from "./apply-progress-state";

export class ApplyProgressModal extends Modal {
  readonly progress: ApplyProgressState;

  constructor(app: ConstructorParameters<typeof Modal>[0], private readonly t: Translate = createTranslator("en")) {
    super(app);
    this.progress = new ApplyProgressState(t);
  }

  onOpen(): void {
    this.modalEl.addClass("schema-refactor-progress-modal");
    this.render();
  }

  update(state: TransactionState, path?: string): void {
    this.progress.update(state, path);
    this.render();
  }

  fail(message: string): void {
    this.progress.fail(message);
    this.render();
  }

  close(): void {
    if (this.progress.canClose()) super.close();
  }

  private render(): void {
    this.contentEl.empty();
    this.setTitle(this.progress.terminal ? this.t("transactionFinished") : this.t("applyingChanges"));
    const status = this.contentEl.createDiv({ cls: "schema-refactor-progress-modal__status", attr: { role: "status", "aria-live": "polite" } });
    const icon = status.createSpan();
    setIcon(icon, this.progress.terminal ? (this.progress.state === "COMPLETED" ? "circle-check" : "circle-alert") : "loader-circle");
    const copy = status.createDiv();
    copy.createEl("strong", { text: this.progress.message });
    if (this.progress.path) copy.createSpan({ text: this.progress.path });
    if (!this.progress.terminal) this.contentEl.createEl("p", { text: this.t("keepObsidianOpen") });
    else {
      const actions = this.contentEl.createDiv({ cls: "modal-button-container" });
      actions.createEl("button", { cls: "mod-cta", text: this.t("close") }).addEventListener("click", () => this.close());
    }
  }
}
