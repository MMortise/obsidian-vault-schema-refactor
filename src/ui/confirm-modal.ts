import { Modal, setIcon } from "obsidian";
import type { ChangePlan } from "../domain/types";

export class ConfirmApplyModal extends Modal {
  constructor(app: ConstructorParameters<typeof Modal>[0], private readonly plan: ChangePlan, private readonly onConfirm: () => void) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("schema-refactor-confirm");
    contentEl.createEl("h2", { text: "Apply reviewed changes?" });
    const facts = contentEl.createDiv({ cls: "schema-refactor-confirm__facts" });
    facts.createDiv({ text: `${this.plan.fileChanges.length} files will change` });
    facts.createDiv({ text: `${this.plan.exclusions.length} files excluded` });
    facts.createDiv({ text: "A local snapshot will be created first" });
    contentEl.createEl("p", { text: "Do not edit these files externally until verification finishes." });
    const actions = contentEl.createDiv({ cls: "modal-button-container" });
    actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    const confirm = actions.createEl("button", { cls: "mod-cta" });
    setIcon(confirm, "play");
    confirm.createSpan({ text: "Apply changes" });
    confirm.addEventListener("click", () => { this.close(); this.onConfirm(); });
  }

  onClose(): void { this.contentEl.empty(); }
}
