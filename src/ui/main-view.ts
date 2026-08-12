import { ItemView, Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import type SchemaRefactorPlugin from "../main";
import type { ChangePlan, ConflictDecision, Finding, ScanProgress } from "../domain/types";
import { createTranslator, findingMessage, transactionStateLabel, type Translate } from "../i18n";
import { buildLineDiff, diffSummary } from "../planning/diff-builder";
import { createReport, reportToJson, reportToMarkdown } from "../report/report";
import { ConfirmApplyModal } from "./confirm-modal";
import type { TransactionManifest } from "../transaction/types";
import { RefactorRequestState } from "./refactor-request-state";
import { ApplyProgressModal } from "./apply-progress-modal";

export const SCHEMA_REFACTOR_VIEW = "schema-refactor-view";
type Tab = "refactor" | "doctor";

export class SchemaRefactorView extends ItemView {
  private tab: Tab = "refactor";
  private readonly requestState = new RefactorRequestState();
  private conflictDecision: ConflictDecision = "block";
  private busy = false;
  private scanController: AbortController | undefined;
  private progress: ScanProgress | undefined;
  private history: TransactionManifest[] = [];

  constructor(leaf: WorkspaceLeaf, private readonly plugin: SchemaRefactorPlugin) { super(leaf); }
  getViewType(): string { return SCHEMA_REFACTOR_VIEW; }
  getDisplayText(): string { return "Schema Refactor"; }
  getIcon(): string { return "scan-search"; }
  private get t(): Translate { return createTranslator(this.plugin.settings.language); }

  async onOpen(): Promise<void> { this.history = await this.plugin.service.history(); this.render(); }
  refreshLanguage(): void { this.render(); }

  private render(): void {
    const t = this.t;
    const root = this.contentEl;
    root.empty();
    root.addClass("schema-refactor");
    const header = root.createDiv({ cls: "schema-refactor__header" });
    const identity = header.createDiv();
    identity.createEl("h1", { text: t("appName") });
    identity.createEl("p", { text: t("headerTagline") });
    const tabs = header.createDiv({ cls: "schema-refactor__tabs", attr: { role: "tablist" } });
    this.tabButton(tabs, "refactor", t("replace"), "replace");
    this.tabButton(tabs, "doctor", t("doctor"), "stethoscope");
    const main = root.createDiv({ cls: "schema-refactor__main" });
    if (this.tab === "refactor") this.renderRefactor(main);
    else this.renderDoctor(main);
  }

  private tabButton(parent: HTMLElement, tab: Tab, label: string, icon: string): void {
    const button = parent.createEl("button", { cls: this.tab === tab ? "is-active" : "", attr: { role: "tab", "aria-selected": String(this.tab === tab) } });
    setIcon(button, icon);
    button.createSpan({ text: label });
    button.addEventListener("click", () => { this.tab = tab; this.render(); });
  }

  private renderRefactor(root: HTMLElement): void {
    const t = this.t;
    this.renderSteps(root);
    const configure = root.createDiv({ cls: "schema-refactor__section" });
    configure.createEl("h2", { text: t("propertyRename") });
    const form = configure.createDiv({ cls: "schema-refactor__form" });
    const known = [...(this.plugin.service.inventory?.propertyTypes.keys() ?? [])].sort();
    const oldField = this.field(form, t("oldProperty"), t("oldPropertyHint"));
    const oldInput = oldField.createEl("input", { type: "text", value: this.requestState.oldName, attr: { list: "schema-refactor-properties", autocomplete: "off" } });
    const dataList = oldField.createEl("datalist", { attr: { id: "schema-refactor-properties" } });
    known.forEach((name) => dataList.createEl("option", { value: name }));
    oldInput.addEventListener("input", () => { this.requestState.setOldName(oldInput.value); this.invalidateRenderedPlan(); });
    const newField = this.field(form, t("newProperty"), t("newPropertyHint"));
    const newInput = newField.createEl("input", { type: "text", value: this.requestState.newName });
    newInput.addEventListener("input", () => { this.requestState.setNewName(newInput.value); this.invalidateRenderedPlan(); });
    const conflictField = this.field(form, t("conflictPrompt"), t("conflictHint"));
    const select = conflictField.createEl("select");
    const conflictOptions: Array<[ConflictDecision, string]> = [["block", t("conflictBlock")], ["keep-target", t("conflictKeepTarget")], ["keep-source", t("conflictKeepSource")], ["merge-lists", t("conflictMergeLists")]];
    conflictOptions.forEach(([value, label]) => select.createEl("option", { value, text: label }));
    select.value = this.conflictDecision;
    select.addEventListener("change", () => { this.conflictDecision = select.value as ConflictDecision; });
    const scopeField = this.field(form, t("scope"), t("scopeHint"));
    scopeField.createEl("input", { type: "text", value: t("entireVault"), attr: { disabled: "" } });
    const actions = configure.createDiv({ cls: "schema-refactor__actions" });
    const scan = this.iconButton(actions, this.plugin.service.inventory ? t("rescanVault") : t("scanVault"), "scan-search", true);
    scan.disabled = this.busy;
    scan.addEventListener("click", () => void this.scanAndPlan());
    if (this.busy && this.scanController) {
      const cancel = this.iconButton(actions, t("cancelScan"), "square");
      cancel.addEventListener("click", () => this.scanController?.abort());
    }
    if (this.progress) configure.createEl("p", { cls: "schema-refactor__progress", text: t("scanProgress", { processed: this.progress.processed, total: this.progress.total, references: this.progress.exactReferences }) });
    if (this.plugin.service.plan) this.renderPlan(root, this.plugin.service.plan);
    if (this.requestState.resultMessage) root.createDiv({ cls: "schema-refactor__result", text: this.requestState.resultMessage });
    this.renderHistory(root);
  }

  private renderSteps(root: HTMLElement): void {
    const t = this.t;
    const hasInventory = this.plugin.service.inventory !== undefined;
    const hasPlan = this.plugin.service.plan !== undefined;
    const steps = root.createDiv({ cls: "schema-refactor__steps", attr: { "aria-label": t("refactorProgress") } });
    [t("stepConfigure"), t("stepScan"), t("stepReview"), t("stepConfirm"), t("stepApply"), t("stepVerify")].forEach((label, index) => {
      const complete = index === 0 || (index === 1 && hasInventory) || (index === 2 && hasPlan) || (index > 2 && this.requestState.resultMessage.length > 0);
      const item = steps.createDiv({ cls: complete ? "is-complete" : "" });
      item.createSpan({ cls: "schema-refactor__step-index", text: String(index + 1) });
      item.createSpan({ text: label });
    });
  }

  private renderPlan(root: HTMLElement, plan: ChangePlan): void {
    const t = this.t;
    const section = root.createDiv({ cls: "schema-refactor__section schema-refactor__review" });
    section.createEl("h2", { text: t("review") });
    const stats = section.createDiv({ cls: "schema-refactor__stats" });
    this.stat(stats, String(plan.fileChanges.filter((item) => item.kind === "markdown").length), t("markdownFiles"));
    this.stat(stats, String(plan.fileChanges.filter((item) => item.kind === "base").length), t("baseFiles"));
    this.stat(stats, String(plan.fileChanges.reduce((sum, item) => sum + item.operations.length, 0)), t("exactChanges"));
    const blockingFindings = plan.unresolvedFindings.filter((item) => item.severity === "blocker");
    const reviewFindings = plan.unresolvedFindings.filter((item) => item.severity !== "blocker");
    this.stat(stats, String(blockingFindings.length), t("blockers"));
    if (blockingFindings.length > 0) {
      const blockers = section.createDiv({ cls: "schema-refactor__blockers" });
      blockers.createEl("strong", { text: t("planCannotApply") });
      blockingFindings.forEach((item) => {
        const row = blockers.createDiv({ cls: "schema-refactor__blocker-row" });
        row.createEl("p", { text: `${item.filePath || t("request")}: ${findingMessage(item, t)}` });
        if (item.filePath && (item.ruleId === "MARKDOWN_CONFLICT" || item.ruleId === "BASE_CONFLICT")) {
          const select = row.createEl("select", { attr: { "aria-label": t("resolveConflict", { path: item.filePath }) } });
          const choices: Array<[ConflictDecision | "exclude", string]> = item.ruleId === "BASE_CONFLICT"
            ? [["block", t("chooseAction")], ["keep-target", t("keepTarget")], ["keep-source", t("keepSource")], ["exclude", t("excludeFile")]]
            : [["block", t("chooseAction")], ["keep-target", t("keepTarget")], ["keep-source", t("keepSource")], ["merge-lists", t("mergeLists")], ["exclude", t("excludeFile")]];
          choices.forEach(([value, label]) => select.createEl("option", { value, text: label }));
          select.addEventListener("change", () => {
            if (select.value === "exclude") this.requestState.excludedPaths.add(item.filePath);
            else this.requestState.conflictDecisions[item.filePath] = select.value as ConflictDecision;
            void this.rebuildPlan();
          });
        }
      });
    }
    if (reviewFindings.length > 0) {
      const review = section.createDiv({ cls: "schema-refactor__manual-review" });
      review.createEl("strong", { text: t("manualReview", { count: reviewFindings.length }) });
      reviewFindings.forEach((item) => review.createEl("p", {
        text: `${item.filePath}${item.structuralPath ? ` > ${item.structuralPath.join(" > ")}` : ""}: ${findingMessage(item, t)}${item.evidence ? ` (${item.evidence})` : ""}`
      }));
    }
    const files = section.createDiv({ cls: "schema-refactor__files" });
    for (const change of plan.fileChanges) {
      const details = files.createEl("details", { cls: "schema-refactor__file" });
      const summary = details.createEl("summary");
      const checkbox = summary.createEl("input", { type: "checkbox", attr: { "aria-label": t("includeFilePath", { path: change.path }) } });
      checkbox.checked = !this.requestState.excludedPaths.has(change.path);
      checkbox.disabled = plan.adapterVersion === "restore-v1";
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", () => { if (checkbox.checked) this.requestState.excludedPaths.delete(change.path); else this.requestState.excludedPaths.add(change.path); void this.rebuildPlan(); });
      const name = summary.createDiv({ cls: "schema-refactor__file-name" });
      name.createEl("strong", { text: change.path });
      const counts = diffSummary(change);
      name.createSpan({ text: t("changesCount", { count: change.operations.length, additions: counts.additions, deletions: counts.deletions }) });
      const open = this.iconButton(summary, t("openSourceFile"), "file-search", false, true);
      open.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); void this.openFile(change.path); });
      const evidence = details.createDiv({ cls: "schema-refactor__evidence" });
      change.operations.forEach((operation) => evidence.createEl("div", { text: `${operation.structuralPath.join(" > ") || t("frontmatter")}: ${operation.before} → ${operation.after}` }));
      const diff = details.createEl("pre", { cls: "schema-refactor__diff", attr: { tabindex: "0", "aria-label": t("diffFor", { path: change.path }) } });
      for (const chunk of buildLineDiff(change)) diff.createEl("span", { cls: chunk.added ? "is-added" : chunk.removed ? "is-removed" : "", text: chunk.value });
    }
    for (const exclusion of plan.exclusions) {
      const row = files.createDiv({ cls: "schema-refactor__excluded-file" });
      const copy = row.createDiv();
      copy.createEl("strong", { text: exclusion.path });
      copy.createSpan({ text: t("oldReferencesRemain", { count: exclusion.remainingReferences }) });
      if (plan.adapterVersion !== "restore-v1") {
        const include = this.iconButton(row, t("includeFile"), "plus", false, true);
        include.addEventListener("click", () => { this.requestState.excludedPaths.delete(exclusion.path); void this.rebuildPlan(); });
      }
    }
    const footer = section.createDiv({ cls: "schema-refactor__review-footer" });
    footer.createEl("p", { text: t("exclusionsSummary", { files: plan.exclusions.length, references: plan.exclusions.reduce((sum, item) => sum + item.remainingReferences, 0) }) });
    if (plan.status === "ready" && this.plugin.service.canWrite) {
      const apply = this.iconButton(footer, t("reviewAndApply"), "play", true);
      apply.disabled = this.busy;
      apply.addEventListener("click", () => new ConfirmApplyModal(this.app, plan, () => void this.applyPlan(plan), t).open());
    } else if (!this.plugin.service.canWrite) footer.createEl("p", { cls: "schema-refactor__mobile-note", text: t("mobileWritesDisabled") });
  }

  private renderDoctor(root: HTMLElement): void {
    const t = this.t;
    const toolbar = root.createDiv({ cls: "schema-refactor__doctor-toolbar" });
    const heading = toolbar.createDiv();
    heading.createEl("h2", { text: t("vaultHealth") });
    heading.createEl("p", { text: t("vaultHealthHint") });
    const actions = toolbar.createDiv({ cls: "schema-refactor__actions" });
    const scan = this.iconButton(actions, t("runDoctor"), "scan-search", true);
    scan.disabled = this.busy;
    scan.addEventListener("click", () => void this.runDoctor());
    if (this.busy && this.scanController) {
      const cancel = this.iconButton(actions, t("cancelScan"), "square");
      cancel.addEventListener("click", () => this.scanController?.abort());
    }
    if (this.plugin.service.findings.length > 0) {
      const exportMd = this.iconButton(actions, t("exportMarkdown"), "file-down");
      exportMd.addEventListener("click", () => void this.exportReport("md"));
      const exportJson = this.iconButton(actions, t("exportJson"), "braces");
      exportJson.addEventListener("click", () => void this.exportReport("json"));
    }
    if (this.progress) root.createEl("p", { cls: "schema-refactor__progress", text: t("doctorProgress", { processed: this.progress.processed, total: this.progress.total }) });
    this.renderFindings(root, this.plugin.service.findings);
  }

  private renderHistory(root: HTMLElement): void {
    const t = this.t;
    const section = root.createDiv({ cls: "schema-refactor__section schema-refactor__history" });
    const title = section.createDiv({ cls: "schema-refactor__section-title" });
    title.createEl("h2", { text: t("history") });
    const refresh = this.iconButton(title, t("refreshHistory"), "refresh-cw", false, true);
    refresh.addEventListener("click", () => void this.refreshHistory());
    if (this.history.length === 0) {
      section.createEl("p", { cls: "schema-refactor__muted", text: t("historyEmpty") });
      return;
    }
    for (const transaction of this.history.slice(0, 20)) {
      const row = section.createDiv({ cls: "schema-refactor__history-row" });
      const stateIcon = row.createSpan({ cls: `is-${transaction.state.toLocaleLowerCase()}`, attr: { "aria-label": transaction.state } });
      setIcon(stateIcon, transaction.state === "COMPLETED" ? "circle-check" : transaction.state === "ROLLBACK_INCOMPLETE" ? "circle-alert" : "history");
      const copy = row.createDiv();
      copy.createEl("strong", { text: `${transaction.request.oldName} → ${transaction.request.newName}` });
      copy.createEl("span", { text: t("transactionSummary", { state: transactionStateLabel(transaction.state, t), count: transaction.entries.length, date: new Date(transaction.createdAt).toLocaleString(this.plugin.settings.language) }) });
      if (transaction.state === "COMPLETED" && this.plugin.service.canWrite) {
        const undo = this.iconButton(row, t("createUndoPlan"), "undo-2", false, true);
        undo.addEventListener("click", () => void this.prepareUndo(transaction));
      } else if (!["ROLLED_BACK", "ROLLBACK_INCOMPLETE", "CANCELLED"].includes(transaction.state) && this.plugin.service.canWrite) {
        const recover = this.iconButton(row, t("recoverTransaction"), "rotate-ccw", false, true);
        recover.addEventListener("click", () => void this.recoverTransaction(transaction));
      }
    }
  }

  private renderFindings(root: HTMLElement, findings: Finding[]): void {
    const t = this.t;
    if (findings.length === 0) {
      root.createDiv({ cls: "schema-refactor__empty", text: this.plugin.service.inventory ? t("noFindings") : t("doctorEmpty") });
      return;
    }
    const groups: Array<[Finding["severity"], string]> = [["error", t("errors")], ["warning", t("warnings")], ["info", t("information")]];
    for (const [severity, label] of groups) {
      const items = findings.filter((item) => item.severity === severity);
      if (items.length === 0) continue;
      const section = root.createDiv({ cls: `schema-refactor__finding-group is-${severity}` });
      section.createEl("h3", { text: `${label} ${items.length}` });
      for (const item of items) {
        const row = section.createDiv({ cls: "schema-refactor__finding" });
        const icon = row.createSpan({ cls: "schema-refactor__finding-icon", attr: { "aria-label": severity } });
        setIcon(icon, severity === "error" ? "circle-alert" : severity === "warning" ? "triangle-alert" : "info");
        const copy = row.createDiv();
        copy.createEl("strong", { text: findingMessage(item, t) });
        copy.createEl("div", { cls: "schema-refactor__finding-meta", text: `${item.ruleId} · ${item.filePath || t("vault")}${item.structuralPath ? ` · ${item.structuralPath.join(" > ")}` : ""}` });
        if (item.suggestedAction === "create-refactor" && item.refactorRequest) {
          const refactor = this.iconButton(row, t("createRefactorPlan"), "replace", false, true);
          refactor.addEventListener("click", () => this.createRefactorFromFinding(item));
        }
        if (item.filePath) { const open = this.iconButton(row, t("openFile"), "external-link", false, true); open.addEventListener("click", () => void this.openFile(item.filePath)); }
      }
    }
  }

  private field(parent: HTMLElement, label: string, description: string): HTMLLabelElement {
    const field = parent.createEl("label", { cls: "schema-refactor__field" });
    field.createEl("span", { cls: "schema-refactor__label", text: label });
    field.createEl("span", { cls: "schema-refactor__hint", text: description });
    return field;
  }

  private iconButton(parent: HTMLElement, label: string, icon: string, primary = false, iconOnly = false): HTMLButtonElement {
    const button = parent.createEl("button", { cls: `${primary ? "mod-cta " : ""}${iconOnly ? "clickable-icon" : "schema-refactor__button"}`, attr: { "aria-label": label } });
    setIcon(button, icon);
    if (!iconOnly) button.createSpan({ text: label });
    if (iconOnly) button.setAttribute("data-tooltip-position", "top");
    return button;
  }

  private stat(parent: HTMLElement, value: string, label: string): void {
    const item = parent.createDiv();
    item.createEl("strong", { text: value });
    item.createSpan({ text: label });
  }

  private invalidateRenderedPlan(): void {
    this.plugin.service.plan = undefined;
    this.contentEl.querySelector(".schema-refactor__review")?.remove();
    this.contentEl.querySelector(".schema-refactor__result")?.remove();
    const steps = this.contentEl.querySelectorAll(".schema-refactor__steps > div");
    for (let index = 2; index < steps.length; index += 1) steps[index]?.classList.remove("is-complete");
  }

  private async scanAndPlan(): Promise<void> {
    const t = this.t;
    if (!this.requestState.oldName || !this.requestState.newName) { new Notice(t("enterPropertyNames")); return; }
    this.busy = true; this.progress = undefined; this.requestState.resultMessage = ""; this.scanController = new AbortController(); this.render();
    try {
      await this.plugin.service.scan((progress) => { this.progress = progress; if (progress.processed === progress.total || progress.processed % 50 === 0) this.render(); }, this.scanController.signal);
      await this.rebuildPlan(false);
    } catch (error) { new Notice(error instanceof DOMException && error.name === "AbortError" ? t("scanCancelled") : error instanceof Error ? error.message : t("scanFailed")); }
    finally { this.busy = false; this.scanController = undefined; this.render(); }
  }

  private async rebuildPlan(render = true): Promise<void> {
    const plan = await this.plugin.service.createPlan({ oldName: this.requestState.oldName, newName: this.requestState.newName, defaultConflictDecision: this.conflictDecision, conflictDecisions: this.requestState.conflictDecisions, excludedPaths: [...this.requestState.excludedPaths] });
    this.requestState.setReviewedPlan(plan);
    if (render) this.render();
  }

  private async applyPlan(plan: ChangePlan): Promise<void> {
    const t = this.t;
    const progressModal = new ApplyProgressModal(this.app, t);
    progressModal.open();
    this.busy = true; this.requestState.resultMessage = t("preparingTransaction"); this.render();
    try {
      const result = await this.plugin.service.apply(plan, { onState: (state, path) => {
        progressModal.update(state, path);
        this.requestState.resultMessage = `${transactionStateLabel(state, t)}${path ? ` · ${path}` : ""}`;
        this.render();
      } });
      this.requestState.resultMessage = result.state === "COMPLETED"
        ? t("completedFiles", { count: result.modifiedPaths.length })
        : result.state === "ROLLED_BACK"
          ? t("applyRolledBack")
          : t("rollbackIncomplete", { paths: result.rollbackIncompletePaths.join(", ") });
      this.history = await this.plugin.service.history();
      await this.plugin.service.pruneHistory(this.plugin.settings.snapshotRetention);
      new Notice(this.requestState.resultMessage, 8000);
    } catch (error) {
      this.requestState.resultMessage = error instanceof Error ? error.message : t("applyFailed");
      progressModal.fail(this.requestState.resultMessage);
      new Notice(this.requestState.resultMessage, 8000);
    }
    finally { this.busy = false; this.render(); }
  }

  private async prepareUndo(transaction: TransactionManifest): Promise<void> {
    const t = this.t;
    try {
      const result = await this.plugin.service.createRestorePlan(transaction);
      this.requestState.oldName = result.plan.request.oldName;
      this.requestState.newName = result.plan.request.newName;
      this.requestState.excludedPaths = new Set(result.plan.request.excludedPaths ?? []);
      this.requestState.setReviewedPlan(result.plan);
      this.requestState.resultMessage = [...result.divergedPaths, ...result.missingPaths].length > 0
        ? t("undoExcludesFiles", { paths: [...result.divergedPaths, ...result.missingPaths].join(", ") })
        : t("undoReady");
      this.render();
    } catch (error) { new Notice(error instanceof Error ? error.message : t("undoFailed")); }
  }

  private async refreshHistory(): Promise<void> { this.history = await this.plugin.service.history(); this.render(); }

  private async recoverTransaction(transaction: TransactionManifest): Promise<void> {
    const t = this.t;
    const confirmed = window.confirm(t("recoverConfirm", { id: transaction.transactionId }));
    if (!confirmed) return;
    this.busy = true;
    this.requestState.resultMessage = t("checkingRecovery");
    this.render();
    try {
      const result = await this.plugin.service.recoverTransaction(transaction);
      this.requestState.resultMessage = result?.state === "ROLLED_BACK"
        ? t("recoveryComplete")
        : result?.state === "ROLLBACK_INCOMPLETE"
          ? t("recoveryIncomplete", { paths: result.rollbackIncompletePaths.join(", ") })
          : t("recoveryNotRequired");
      this.history = await this.plugin.service.history();
      new Notice(this.requestState.resultMessage, 10000);
    } catch (error) {
      this.requestState.resultMessage = error instanceof Error ? error.message : t("recoveryFailed");
      new Notice(this.requestState.resultMessage, 10000);
    } finally { this.busy = false; this.render(); }
  }

  private async runDoctor(): Promise<void> {
    const t = this.t;
    this.busy = true; this.progress = undefined; this.scanController = new AbortController(); this.render();
    try { await this.plugin.service.doctor((progress) => { this.progress = progress; if (progress.processed === progress.total || progress.processed % 50 === 0) this.render(); }, this.scanController.signal); }
    catch (error) { new Notice(error instanceof DOMException && error.name === "AbortError" ? t("doctorCancelled") : error instanceof Error ? error.message : t("doctorFailed")); }
    finally { this.busy = false; this.scanController = undefined; this.render(); }
  }

  private async exportReport(extension: "md" | "json"): Promise<void> {
    const report = createReport(this.plugin.service.findings, this.plugin.manifest.version, new Date().toISOString(), {
      includeTypeStats: extension === "json" && this.plugin.settings.includeTypeStats,
      ...(this.plugin.service.inventory ? { propertyTypes: this.plugin.service.inventory.propertyTypes } : {})
    });
    const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
    const path = `schema-refactor-report-${stamp}.${extension}`;
    await this.app.vault.create(path, extension === "md" ? reportToMarkdown(report) : reportToJson(report));
    new Notice(this.t("reportCreated", { path }));
  }

  private async openFile(path: string): Promise<void> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) { new Notice(this.t("fileNotFound", { path })); return; }
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  private createRefactorFromFinding(finding: Finding): void {
    if (!finding.refactorRequest) return;
    this.requestState.invalidateReview();
    this.plugin.service.plan = undefined;
    this.requestState.oldName = finding.refactorRequest.oldName;
    this.requestState.newName = finding.refactorRequest.newName;
    this.tab = "refactor";
    this.render();
  }
}
