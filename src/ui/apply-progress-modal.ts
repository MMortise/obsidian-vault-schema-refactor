import { Modal, setIcon } from "obsidian";
import type { TransactionState } from "../transaction/types";
import { ApplyProgressState } from "./apply-progress-state";

export class ApplyProgressModal extends Modal {
  readonly progress = new ApplyProgressState();

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
    this.contentEl.createEl("h2", { text: this.progress.terminal ? "Transaction finished" : "Applying reviewed changes" });
    const status = this.contentEl.createDiv({ cls: "schema-refactor-progress-modal__status", attr: { role: "status", "aria-live": "polite" } });
    const icon = status.createSpan();
    setIcon(icon, this.progress.terminal ? (this.progress.state === "COMPLETED" ? "circle-check" : "circle-alert") : "loader-circle");
    const copy = status.createDiv();
    copy.createEl("strong", { text: this.progress.message });
    if (this.progress.path) copy.createEl("span", { text: this.progress.path });
    if (!this.progress.terminal) this.contentEl.createEl("p", { text: "Keep Obsidian open. This window will remain until verification or rollback finishes." });
    else {
      const actions = this.contentEl.createDiv({ cls: "modal-button-container" });
      actions.createEl("button", { cls: "mod-cta", text: "Close" }).addEventListener("click", () => this.close());
    }
  }
}
