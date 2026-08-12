import { ItemView, Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import type SchemaRefactorPlugin from "../main";
import type { ChangePlan, ConflictDecision, Finding, ScanProgress } from "../domain/types";
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

  async onOpen(): Promise<void> { this.history = await this.plugin.service.history(); this.render(); }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("schema-refactor");
    const header = root.createDiv({ cls: "schema-refactor__header" });
    const identity = header.createDiv();
    identity.createEl("h1", { text: "Schema Refactor" });
    identity.createEl("p", { text: "Review every property definition and Base reference before anything changes." });
    const tabs = header.createDiv({ cls: "schema-refactor__tabs", attr: { role: "tablist" } });
    this.tabButton(tabs, "refactor", "Replace", "replace");
    this.tabButton(tabs, "doctor", "Doctor", "stethoscope");
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
    this.renderSteps(root);
    const configure = root.createDiv({ cls: "schema-refactor__section" });
    configure.createEl("h2", { text: "Property rename" });
    const form = configure.createDiv({ cls: "schema-refactor__form" });
    const known = [...(this.plugin.service.inventory?.propertyTypes.keys() ?? [])].sort();
    const oldField = this.field(form, "Old property", "Property currently used in the Vault");
    const oldInput = oldField.createEl("input", { type: "text", value: this.requestState.oldName, attr: { list: "schema-refactor-properties", autocomplete: "off" } });
    const dataList = oldField.createEl("datalist", { attr: { id: "schema-refactor-properties" } });
    known.forEach((name) => dataList.createEl("option", { value: name }));
    oldInput.addEventListener("input", () => { this.requestState.setOldName(oldInput.value); this.plugin.service.plan = undefined; this.render(); });
    const newField = this.field(form, "New property", "The target YAML property name");
    const newInput = newField.createEl("input", { type: "text", value: this.requestState.newName });
    newInput.addEventListener("input", () => { this.requestState.setNewName(newInput.value); this.plugin.service.plan = undefined; this.render(); });
    const conflictField = this.field(form, "When both properties exist", "Choose a default; blocked files can be excluded during review");
    const select = conflictField.createEl("select");
    const conflictOptions: Array<[ConflictDecision, string]> = [["block", "Block and review"], ["keep-target", "Keep target value"], ["keep-source", "Keep source value"], ["merge-lists", "Merge lists only"]];
    conflictOptions.forEach(([value, label]) => select.createEl("option", { value, text: label }));
    select.value = this.conflictDecision;
    select.addEventListener("change", () => { this.conflictDecision = select.value as ConflictDecision; });
    const scopeField = this.field(form, "Scope", "Property references are global, so MVP plans always cover the whole Vault");
    scopeField.createEl("input", { type: "text", value: "Entire Vault", attr: { disabled: "" } });
    const actions = configure.createDiv({ cls: "schema-refactor__actions" });
    const scan = this.iconButton(actions, this.plugin.service.inventory ? "Rescan Vault" : "Scan Vault", "scan-search", true);
    scan.disabled = this.busy;
    scan.addEventListener("click", () => void this.scanAndPlan());
    if (this.busy && this.scanController) {
      const cancel = this.iconButton(actions, "Cancel scan", "square");
      cancel.addEventListener("click", () => this.scanController?.abort());
    }
    if (this.progress) configure.createEl("p", { cls: "schema-refactor__progress", text: `${this.progress.processed} / ${this.progress.total} files · ${this.progress.exactReferences} exact references` });
    if (this.plugin.service.plan) this.renderPlan(root, this.plugin.service.plan);
    if (this.requestState.resultMessage) root.createDiv({ cls: "schema-refactor__result", text: this.requestState.resultMessage });
    this.renderHistory(root);
  }

  private renderSteps(root: HTMLElement): void {
    const hasInventory = this.plugin.service.inventory !== undefined;
    const hasPlan = this.plugin.service.plan !== undefined;
    const steps = root.createDiv({ cls: "schema-refactor__steps", attr: { "aria-label": "Refactor progress" } });
    ["Configure", "Scan", "Review", "Confirm", "Apply", "Verify"].forEach((label, index) => {
      const complete = index === 0 || (index === 1 && hasInventory) || (index === 2 && hasPlan) || (index > 2 && this.requestState.resultMessage.length > 0);
      const item = steps.createDiv({ cls: complete ? "is-complete" : "" });
      item.createSpan({ cls: "schema-refactor__step-index", text: String(index + 1) });
      item.createSpan({ text: label });
    });
  }

  private renderPlan(root: HTMLElement, plan: ChangePlan): void {
    const section = root.createDiv({ cls: "schema-refactor__section schema-refactor__review" });
    section.createEl("h2", { text: "Review" });
    const stats = section.createDiv({ cls: "schema-refactor__stats" });
    this.stat(stats, String(plan.fileChanges.filter((item) => item.kind === "markdown").length), "Markdown files");
    this.stat(stats, String(plan.fileChanges.filter((item) => item.kind === "base").length), "Base files");
    this.stat(stats, String(plan.fileChanges.reduce((sum, item) => sum + item.operations.length, 0)), "Exact changes");
    const blockingFindings = plan.unresolvedFindings.filter((item) => item.severity === "blocker");
    const reviewFindings = plan.unresolvedFindings.filter((item) => item.severity !== "blocker");
    this.stat(stats, String(blockingFindings.length), "Blockers");
    if (blockingFindings.length > 0) {
      const blockers = section.createDiv({ cls: "schema-refactor__blockers" });
      blockers.createEl("strong", { text: "Plan cannot be applied" });
      blockingFindings.forEach((item) => {
        const row = blockers.createDiv({ cls: "schema-refactor__blocker-row" });
        row.createEl("p", { text: `${item.filePath || "Request"}: ${item.message}` });
        if (item.filePath && (item.ruleId === "MARKDOWN_CONFLICT" || item.ruleId === "BASE_CONFLICT")) {
          const select = row.createEl("select", { attr: { "aria-label": `Resolve conflict in ${item.filePath}` } });
          const choices: Array<[ConflictDecision | "exclude", string]> = item.ruleId === "BASE_CONFLICT"
            ? [["block", "Choose action…"], ["keep-target", "Keep target"], ["keep-source", "Keep source"], ["exclude", "Exclude file"]]
            : [["block", "Choose action…"], ["keep-target", "Keep target"], ["keep-source", "Keep source"], ["merge-lists", "Merge lists"], ["exclude", "Exclude file"]];
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
      review.createEl("strong", { text: `Manual review · ${reviewFindings.length}` });
      reviewFindings.forEach((item) => review.createEl("p", {
        text: `${item.filePath}${item.structuralPath ? ` > ${item.structuralPath.join(" > ")}` : ""}: ${item.message}${item.evidence ? ` (${item.evidence})` : ""}`
      }));
    }
    const files = section.createDiv({ cls: "schema-refactor__files" });
    for (const change of plan.fileChanges) {
      const details = files.createEl("details", { cls: "schema-refactor__file" });
      const summary = details.createEl("summary");
      const checkbox = summary.createEl("input", { type: "checkbox", attr: { "aria-label": `Include ${change.path}` } });
      checkbox.checked = !this.requestState.excludedPaths.has(change.path);
      checkbox.disabled = plan.adapterVersion === "restore-v1";
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", () => { if (checkbox.checked) this.requestState.excludedPaths.delete(change.path); else this.requestState.excludedPaths.add(change.path); void this.rebuildPlan(); });
      const name = summary.createDiv({ cls: "schema-refactor__file-name" });
      name.createEl("strong", { text: change.path });
      const counts = diffSummary(change);
      name.createSpan({ text: `${change.operations.length} changes · +${counts.additions} −${counts.deletions}` });
      const open = this.iconButton(summary, "Open source file", "file-search", false, true);
      open.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); void this.openFile(change.path); });
      const evidence = details.createDiv({ cls: "schema-refactor__evidence" });
      change.operations.forEach((operation) => evidence.createEl("div", { text: `${operation.structuralPath.join(" > ") || "Frontmatter"}: ${operation.before} → ${operation.after}` }));
      const diff = details.createEl("pre", { cls: "schema-refactor__diff", attr: { tabindex: "0", "aria-label": `Diff for ${change.path}` } });
      for (const chunk of buildLineDiff(change)) diff.createEl("span", { cls: chunk.added ? "is-added" : chunk.removed ? "is-removed" : "", text: chunk.value });
    }
    for (const exclusion of plan.exclusions) {
      const row = files.createDiv({ cls: "schema-refactor__excluded-file" });
      const copy = row.createDiv();
      copy.createEl("strong", { text: exclusion.path });
      copy.createSpan({ text: `${exclusion.remainingReferences} old definitions or references remain` });
      if (plan.adapterVersion !== "restore-v1") {
        const include = this.iconButton(row, "Include file", "plus", false, true);
        include.addEventListener("click", () => { this.requestState.excludedPaths.delete(exclusion.path); void this.rebuildPlan(); });
      }
    }
    const footer = section.createDiv({ cls: "schema-refactor__review-footer" });
    footer.createEl("p", { text: `${plan.exclusions.length} excluded files leave ${plan.exclusions.reduce((sum, item) => sum + item.remainingReferences, 0)} old definitions or references.` });
    if (plan.status === "ready" && this.plugin.service.canWrite) {
      const apply = this.iconButton(footer, "Review and apply", "play", true);
      apply.disabled = this.busy;
      apply.addEventListener("click", () => new ConfirmApplyModal(this.app, plan, () => void this.applyPlan(plan)).open());
    } else if (!this.plugin.service.canWrite) footer.createEl("p", { cls: "schema-refactor__mobile-note", text: "Apply, rollback, and undo are disabled on mobile in this release." });
  }

  private renderDoctor(root: HTMLElement): void {
    const toolbar = root.createDiv({ cls: "schema-refactor__doctor-toolbar" });
    const heading = toolbar.createDiv();
    heading.createEl("h2", { text: "Vault health" });
    heading.createEl("p", { text: "Read-only checks for broken Base references and schema drift." });
    const actions = toolbar.createDiv({ cls: "schema-refactor__actions" });
    const scan = this.iconButton(actions, "Run Doctor", "scan-search", true);
    scan.disabled = this.busy;
    scan.addEventListener("click", () => void this.runDoctor());
    if (this.busy && this.scanController) {
      const cancel = this.iconButton(actions, "Cancel scan", "square");
      cancel.addEventListener("click", () => this.scanController?.abort());
    }
    if (this.plugin.service.findings.length > 0) {
      const exportMd = this.iconButton(actions, "Export Markdown", "file-down");
      exportMd.addEventListener("click", () => void this.exportReport("md"));
      const exportJson = this.iconButton(actions, "Export JSON", "braces");
      exportJson.addEventListener("click", () => void this.exportReport("json"));
    }
    if (this.progress) root.createEl("p", { cls: "schema-refactor__progress", text: `${this.progress.processed} / ${this.progress.total} files checked` });
    this.renderFindings(root, this.plugin.service.findings);
  }

  private renderHistory(root: HTMLElement): void {
    const section = root.createDiv({ cls: "schema-refactor__section schema-refactor__history" });
    const title = section.createDiv({ cls: "schema-refactor__section-title" });
    title.createEl("h2", { text: "History" });
    const refresh = this.iconButton(title, "Refresh history", "refresh-cw", false, true);
    refresh.addEventListener("click", () => void this.refreshHistory());
    if (this.history.length === 0) {
      section.createEl("p", { cls: "schema-refactor__muted", text: "Completed and interrupted transactions will appear here." });
      return;
    }
    for (const transaction of this.history.slice(0, 20)) {
      const row = section.createDiv({ cls: "schema-refactor__history-row" });
      const stateIcon = row.createSpan({ cls: `is-${transaction.state.toLocaleLowerCase()}`, attr: { "aria-label": transaction.state } });
      setIcon(stateIcon, transaction.state === "COMPLETED" ? "circle-check" : transaction.state === "ROLLBACK_INCOMPLETE" ? "circle-alert" : "history");
      const copy = row.createDiv();
      copy.createEl("strong", { text: `${transaction.request.oldName} → ${transaction.request.newName}` });
      copy.createEl("span", { text: `${transaction.state.replaceAll("_", " ")} · ${transaction.entries.length} files · ${new Date(transaction.createdAt).toLocaleString()}` });
      if (transaction.state === "COMPLETED" && this.plugin.service.canWrite) {
        const undo = this.iconButton(row, "Create undo plan", "undo-2", false, true);
        undo.addEventListener("click", () => void this.prepareUndo(transaction));
      } else if (!["ROLLED_BACK", "ROLLBACK_INCOMPLETE", "CANCELLED"].includes(transaction.state) && this.plugin.service.canWrite) {
        const recover = this.iconButton(row, "Safely restore interrupted transaction", "rotate-ccw", false, true);
        recover.addEventListener("click", () => void this.recoverTransaction(transaction));
      }
    }
  }

  private renderFindings(root: HTMLElement, findings: Finding[]): void {
    if (findings.length === 0) {
      root.createDiv({ cls: "schema-refactor__empty", text: this.plugin.service.inventory ? "No findings in the current scan." : "Run Doctor to inspect Bases and property definitions." });
      return;
    }
    const groups: Array<[Finding["severity"], string]> = [["error", "Errors"], ["warning", "Warnings"], ["info", "Information"]];
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
        copy.createEl("strong", { text: item.message });
        copy.createEl("div", { cls: "schema-refactor__finding-meta", text: `${item.ruleId} · ${item.filePath || "Vault"}${item.structuralPath ? ` · ${item.structuralPath.join(" > ")}` : ""}` });
        if (item.filePath) { const open = this.iconButton(row, "Open file", "external-link", false, true); open.addEventListener("click", () => void this.openFile(item.filePath)); }
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

  private async scanAndPlan(): Promise<void> {
    if (!this.requestState.oldName || !this.requestState.newName) { new Notice("Enter both property names before scanning."); return; }
    this.busy = true; this.progress = undefined; this.requestState.resultMessage = ""; this.scanController = new AbortController(); this.render();
    try {
      await this.plugin.service.scan((progress) => { this.progress = progress; if (progress.processed === progress.total || progress.processed % 50 === 0) this.render(); }, this.scanController.signal);
      await this.rebuildPlan(false);
    } catch (error) { new Notice(error instanceof DOMException && error.name === "AbortError" ? "Scan cancelled. No files were changed." : error instanceof Error ? error.message : "Scan failed."); }
    finally { this.busy = false; this.scanController = undefined; this.render(); }
  }

  private async rebuildPlan(render = true): Promise<void> {
    const plan = await this.plugin.service.createPlan({ oldName: this.requestState.oldName, newName: this.requestState.newName, defaultConflictDecision: this.conflictDecision, conflictDecisions: this.requestState.conflictDecisions, excludedPaths: [...this.requestState.excludedPaths] });
    this.requestState.setReviewedPlan(plan);
    if (render) this.render();
  }

  private async applyPlan(plan: ChangePlan): Promise<void> {
    const progressModal = new ApplyProgressModal(this.app);
    progressModal.open();
    this.busy = true; this.requestState.resultMessage = "Preparing transaction…"; this.render();
    try {
      const result = await this.plugin.service.apply(plan, { onState: (state, path) => {
        progressModal.update(state, path);
        this.requestState.resultMessage = `${state.replaceAll("_", " ")}${path ? ` · ${path}` : ""}`;
        this.render();
      } });
      this.requestState.resultMessage = result.state === "COMPLETED" ? `Completed and verified ${result.modifiedPaths.length} files.` : result.state === "ROLLED_BACK" ? "Apply failed. All changed files were restored." : `Rollback incomplete: ${result.rollbackIncompletePaths.join(", ")}. Snapshots were retained.`;
      this.history = await this.plugin.service.history();
      await this.plugin.service.pruneHistory(this.plugin.settings.snapshotRetention);
      new Notice(this.requestState.resultMessage, 8000);
    } catch (error) {
      this.requestState.resultMessage = error instanceof Error ? error.message : "Apply failed.";
      progressModal.fail(this.requestState.resultMessage);
      new Notice(this.requestState.resultMessage, 8000);
    }
    finally { this.busy = false; this.render(); }
  }

  private async prepareUndo(transaction: TransactionManifest): Promise<void> {
    try {
      const result = await this.plugin.service.createRestorePlan(transaction);
      this.requestState.oldName = result.plan.request.oldName;
      this.requestState.newName = result.plan.request.newName;
      this.requestState.excludedPaths = new Set(result.plan.request.excludedPaths ?? []);
      this.requestState.setReviewedPlan(result.plan);
      this.requestState.resultMessage = [...result.divergedPaths, ...result.missingPaths].length > 0
        ? `Undo plan excludes changed or missing files: ${[...result.divergedPaths, ...result.missingPaths].join(", ")}.`
        : "Undo plan is ready for review.";
      this.render();
    } catch (error) { new Notice(error instanceof Error ? error.message : "Could not create undo plan."); }
  }

  private async refreshHistory(): Promise<void> { this.history = await this.plugin.service.history(); this.render(); }

  private async recoverTransaction(transaction: TransactionManifest): Promise<void> {
    const confirmed = window.confirm(`Restore files written by interrupted transaction ${transaction.transactionId}? Files changed externally will not be overwritten.`);
    if (!confirmed) return;
    this.busy = true;
    this.requestState.resultMessage = "Checking interrupted transaction…";
    this.render();
    try {
      const result = await this.plugin.service.recoverTransaction(transaction);
      this.requestState.resultMessage = result?.state === "ROLLED_BACK"
        ? "Interrupted transaction was safely restored."
        : result?.state === "ROLLBACK_INCOMPLETE"
          ? `Recovery incomplete: ${result.rollbackIncompletePaths.join(", ")}. Snapshots were retained.`
          : "This transaction no longer requires recovery.";
      this.history = await this.plugin.service.history();
      new Notice(this.requestState.resultMessage, 10000);
    } catch (error) {
      this.requestState.resultMessage = error instanceof Error ? error.message : "Recovery failed.";
      new Notice(this.requestState.resultMessage, 10000);
    } finally { this.busy = false; this.render(); }
  }

  private async runDoctor(): Promise<void> {
    this.busy = true; this.progress = undefined; this.scanController = new AbortController(); this.render();
    try { await this.plugin.service.doctor((progress) => { this.progress = progress; if (progress.processed === progress.total || progress.processed % 50 === 0) this.render(); }, this.scanController.signal); }
    catch (error) { new Notice(error instanceof DOMException && error.name === "AbortError" ? "Doctor scan cancelled." : error instanceof Error ? error.message : "Doctor scan failed."); }
    finally { this.busy = false; this.scanController = undefined; this.render(); }
  }

  private async exportReport(extension: "md" | "json"): Promise<void> {
    const report = createReport(this.plugin.service.findings, this.plugin.manifest.version);
    const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
    const path = `schema-refactor-report-${stamp}.${extension}`;
    await this.app.vault.create(path, extension === "md" ? reportToMarkdown(report) : reportToJson(report));
    new Notice(`Created ${path}`);
  }

  private async openFile(path: string): Promise<void> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) { new Notice(`File not found: ${path}`); return; }
    await this.app.workspace.getLeaf(false).openFile(file);
  }
}
