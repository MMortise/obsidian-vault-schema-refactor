export type FileKind = "markdown" | "base";
export type Confidence = "exact" | "probable" | "text";
export type Severity = "blocker" | "error" | "warning" | "info";
export type ValueKind = "null" | "string" | "number" | "boolean" | "list" | "object";

export type SemanticKind =
  | "frontmatter-key"
  | "base-filter"
  | "base-formula"
  | "base-summary"
  | "base-property-config"
  | "view-order"
  | "view-sort"
  | "view-group";

export interface SourceSnapshot {
  path: string;
  kind: FileKind;
  text: string;
  contentHash: string;
  mtime: number;
  size: number;
}

export interface PropertyReference {
  id: string;
  filePath: string;
  fileKind: FileKind;
  semanticKind: SemanticKind;
  structuralPath: Array<string | number>;
  syntaxForm: "note-prefixed" | "bare-identifier" | "serialized-property-id";
  propertyName: string;
  confidence: Confidence;
  range?: { from: number; to: number };
  evidence: string;
}

export interface Finding {
  id: string;
  ruleId: string;
  severity: Severity;
  filePath: string;
  structuralPath?: Array<string | number>;
  confidence: Confidence;
  message: string;
  evidence?: string;
  fingerprint: string;
  suggestedAction?: "create-refactor" | "open-file" | "manual-review";
  refactorRequest?: { oldName: string; newName: string };
}

export type ConflictDecision = "block" | "keep-target" | "keep-source" | "merge-lists";
export type BaseConflictDecision = "block" | "keep-target" | "keep-source";

export interface RenamePropertyRequest {
  oldName: string;
  newName: string;
  defaultConflictDecision: ConflictDecision;
  conflictDecisions?: Record<string, ConflictDecision | BaseConflictDecision>;
  excludedPaths?: string[];
}

export interface ChangeOperation {
  kind: SemanticKind;
  structuralPath: Array<string | number>;
  before: string;
  after: string;
  reason: string;
}

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  blockers: string[];
}

export interface FileChange {
  path: string;
  kind: FileKind;
  beforeHash: string;
  beforeText: string;
  afterText: string;
  afterHash: string;
  operations: ChangeOperation[];
  validation: ValidationResult;
}

export interface ChangePlan {
  schemaVersion: 1;
  planId: string;
  inventoryRevision: string;
  adapterVersion: string;
  createdAt: string;
  request: RenamePropertyRequest;
  sourceSnapshots: Record<string, Pick<SourceSnapshot, "contentHash" | "mtime" | "size">>;
  fileChanges: FileChange[];
  unresolvedFindings: Finding[];
  exclusions: Array<{ path: string; remainingReferences: number }>;
  status: "draft" | "ready" | "stale" | "applied" | "cancelled";
}

export interface MarkdownDocument {
  snapshot: SourceSnapshot;
  properties: Map<string, ValueKind>;
  parseError?: string;
}

export interface BaseDocument {
  snapshot: SourceSnapshot;
  references: PropertyReference[];
  formulaDefinitions: string[];
  formulaUses: string[];
  unknownShapes: Array<{ path: Array<string | number>; evidence: string; searchText?: string }>;
  parseError?: string;
}

export interface InventoryResult {
  revision: string;
  snapshots: SourceSnapshot[];
  markdown: MarkdownDocument[];
  bases: BaseDocument[];
  propertyTypes: Map<string, Set<ValueKind>>;
  references: PropertyReference[];
  errors: Array<{ path: string; message: string }>;
}

export interface ScanProgress {
  processed: number;
  total: number;
  definitions: number;
  exactReferences: number;
  warnings: number;
}
