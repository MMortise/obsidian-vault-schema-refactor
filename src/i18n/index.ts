import type { Finding } from "../domain/types";
import type { TransactionState } from "../transaction/types";
import { en } from "./en";
import { zhCN } from "./zh-cn";

export type Language = "en" | "zh-CN";
export type MessageKey = keyof typeof en;
export type MessageValues = Record<string, string | number>;
export type Translate = (key: MessageKey, values?: MessageValues) => string;

const catalogs: Record<Language, Record<MessageKey, string>> = { en, "zh-CN": zhCN };

export function normalizeLanguage(value: unknown): Language {
  return value === "zh-CN" ? "zh-CN" : "en";
}

export function createTranslator(language: Language): Translate {
  return (key, values = {}) => catalogs[language][key].replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
}

export function transactionStateLabel(state: TransactionState, t: Translate): string {
  const keys: Record<TransactionState, MessageKey> = {
    PREPARING: "statePreparing",
    SNAPSHOTTING: "stateSnapshotting",
    WRITING: "stateWriting",
    VERIFYING: "stateVerifying",
    COMPLETED: "stateCompleted",
    ROLLING_BACK: "stateRollingBack",
    ROLLED_BACK: "stateRolledBack",
    ROLLBACK_INCOMPLETE: "stateRollbackIncomplete",
    CANCELLED: "stateCancelled"
  };
  return t(keys[state]);
}

export function findingMessage(item: Finding, t: Translate): string {
  const evidence = item.evidence ?? "";
  switch (item.ruleId) {
    case "UNPARSEABLE_BASE": return t("findingUnparseableBase");
    case "UNKNOWN_BASE_SHAPE": return t(item.severity === "blocker" ? "findingRiskyUnknownShape" : "findingUnknownShape");
    case "MISSING_PROPERTY": return t("findingMissingProperty", { name: item.refactorRequest?.oldName ?? evidence });
    case "MISSING_FORMULA": return t("findingMissingFormula", { name: evidence.replace(/^formula\./, "") });
    case "UNUSED_FORMULA": return t("findingUnusedFormula", { name: evidence });
    case "CASE_DRIFT": return t("findingCaseDrift", { evidence });
    case "TYPE_DRIFT": return t("findingTypeDrift", { evidence });
    case "INVALID_REQUEST": return t("findingInvalidRequest");
    case "SOURCE_NOT_LOADED": return t("findingSourceNotLoaded");
    case "STALE_SOURCE": return t("findingStaleSource");
    case "MARKDOWN_CONFLICT":
    case "BASE_CONFLICT": return item.message;
    case "LOW_CONFIDENCE_REFERENCE": return t("findingLowConfidence");
    case "PLAN_VALIDATION": return item.message;
    case "EMPTY_PLAN": return t("findingEmptyPlan");
    default: return item.message;
  }
}
