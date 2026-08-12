import type { ChangePlan } from "../domain/types";

export type TransactionState =
  | "PREPARING" | "SNAPSHOTTING" | "WRITING" | "VERIFYING" | "COMPLETED"
  | "ROLLING_BACK" | "ROLLED_BACK" | "ROLLBACK_INCOMPLETE" | "CANCELLED";

export interface SnapshotEntry {
  path: string;
  snapshotFile: string;
  beforeHash: string;
  afterHash: string;
  byteLength: number;
  written: boolean;
  writtenHash?: string;
  rollbackRestored: boolean;
}

export interface TransactionManifest {
  schemaVersion: 1;
  transactionId: string;
  planId: string;
  createdAt: string;
  updatedAt: string;
  state: TransactionState;
  request: ChangePlan["request"];
  entries: SnapshotEntry[];
  verified: string[];
  errors: Array<{ stage: TransactionState; path?: string; message: string }>;
}

export interface TransactionResult {
  transactionId: string;
  state: Extract<TransactionState, "COMPLETED" | "ROLLED_BACK" | "ROLLBACK_INCOMPLETE">;
  errors: TransactionManifest["errors"];
  modifiedPaths: string[];
  rollbackIncompletePaths: string[];
}

export interface TransactionFileStore {
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface TransactionHooks {
  onState?: (state: TransactionState, path?: string) => void;
  injectFailure?: (point: string, path?: string) => void | Promise<void>;
}
