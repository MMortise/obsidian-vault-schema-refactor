import { Modal, setIcon } from "obsidian";
import { createTranslator, type Translate } from "../i18n";

export class RecoveryConfirmModal extends Modal {
  private resolved = false;

  constructor(
    app: ConstructorParameters<typeof Modal>[0],
    private readonly transactionId: string,
    private readonly resolve: (confirmed: boolean) => void,
    private readonly t: Translate = createTranslator("en")
  ) { super(app); }

  onOpen(): void {
    this.setTitle(this.t("recoverTransaction"));
    this.contentEl.createEl("p", { text: this.t("recoverConfirm", { id: this.transactionId }) });
    const actions = this.contentEl.createDiv({ cls: "modal-button-container" });
    actions.createEl("button", { text: this.t("cancel") }).addEventListener("click", () => this.finish(false));
    const confirm = actions.createEl("button", { cls: "mod-warning" });
    setIcon(confirm, "rotate-ccw");
    confirm.createSpan({ text: this.t("restoreFiles") });
    confirm.addEventListener("click", () => this.finish(true));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) this.resolve(false);
  }

  private finish(confirmed: boolean): void {
    this.resolved = true;
    this.resolve(confirmed);
    this.close();
  }
}
