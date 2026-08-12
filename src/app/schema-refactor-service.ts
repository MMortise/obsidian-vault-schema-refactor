import type { App } from "obsidian";
import { Platform } from "obsidian";
import { runDoctor } from "../doctor/rule-engine";
import type { ChangePlan, Finding, InventoryResult, RenamePropertyRequest, ScanProgress } from "../domain/types";
import { VaultInventory } from "../inventory/vault-inventory";
import { buildRenamePlan } from "../planning/plan-builder";
import { checkPlanFreshness } from "../planning/plan-validator";
import { TransactionExecutor } from "../transaction/executor";
import { buildRestorePlan, type RestorePlanResult } from "../transaction/restore-plan";
import { SnapshotStore } from "../transaction/snapshot-store";
import type { TransactionHooks, TransactionManifest, TransactionResult } from "../transaction/types";
import { VaultFileStore } from "../transaction/vault-file-store";

export class SchemaRefactorService {
  readonly snapshotStore: SnapshotStore;
  readonly fileStore: VaultFileStore;
  readonly executor: TransactionExecutor;
  inventory: InventoryResult | undefined;
  findings: Finding[] = [];
  plan: ChangePlan | undefined;

  constructor(private readonly app: App, pluginId: string) {
    this.fileStore = new VaultFileStore(app.vault);
    this.snapshotStore = new SnapshotStore(app.vault.adapter, `${app.vault.configDir}/plugins/${pluginId}/snapshots`);
    this.executor = new TransactionExecutor(this.fileStore, this.snapshotStore);
  }

  get canWrite(): boolean { return !Platform.isMobile; }

  async scan(onProgress?: (progress: ScanProgress) => void, signal?: AbortSignal): Promise<InventoryResult> {
    this.inventory = await new VaultInventory(this.app.vault).scan({ ...(onProgress ? { onProgress } : {}), ...(signal ? { signal } : {}), concurrency: Platform.isMobile ? 2 : 8 });
    return this.inventory;
  }

  async doctor(onProgress?: (progress: ScanProgress) => void, signal?: AbortSignal): Promise<Finding[]> {
    const inventory = await this.scan(onProgress, signal);
    this.findings = await runDoctor(inventory);
    return this.findings;
  }

  async createPlan(request: RenamePropertyRequest): Promise<ChangePlan> {
    const inventory = this.inventory ?? await this.scan();
    this.plan = await buildRenamePlan(inventory, request);
    return this.plan;
  }

  async apply(plan: ChangePlan, hooks: TransactionHooks = {}): Promise<TransactionResult> {
    if (!this.canWrite) throw new Error("Applying changes is disabled on mobile in this release.");
    const freshness = await checkPlanFreshness(this.app.vault, plan);
    if (!freshness.fresh) throw new Error(`Plan is stale. Rescan before applying. ${[...freshness.changedPaths, ...freshness.missingPaths, ...freshness.newCandidatePaths].join(", ")}`);
    const result = await this.executor.execute(plan, hooks);
    this.inventory = undefined;
    this.plan = undefined;
    return result;
  }

  async history(): Promise<TransactionManifest[]> { return this.snapshotStore.list(); }

  async pruneHistory(retention: number): Promise<void> { await this.snapshotStore.prune(retention); }

  async createRestorePlan(manifest: TransactionManifest): Promise<RestorePlanResult> {
    const result = await buildRestorePlan(this.fileStore, this.snapshotStore, manifest);
    this.plan = result.plan;
    return result;
  }

  async recoverIncomplete(): Promise<TransactionResult[]> {
    const results: TransactionResult[] = [];
    for (const manifest of await this.history()) {
      const result = await this.executor.recover(manifest);
      if (result) results.push(result);
    }
    return results;
  }

  async recoverTransaction(manifest: TransactionManifest): Promise<TransactionResult | undefined> {
    return this.executor.recover(manifest);
  }
}
