import type { Finding } from "../domain/types";

export interface DoctorReport {
  schemaVersion: 1;
  pluginVersion: string;
  generatedAt: string;
  summary: Record<"error" | "warning" | "info", number>;
  findings: Finding[];
}

export function createReport(findings: Finding[], pluginVersion: string, generatedAt = new Date().toISOString()): DoctorReport {
  return {
    schemaVersion: 1, pluginVersion, generatedAt,
    summary: {
      error: findings.filter((item) => item.severity === "error").length,
      warning: findings.filter((item) => item.severity === "warning").length,
      info: findings.filter((item) => item.severity === "info").length
    },
    findings
  };
}

export function reportToJson(report: DoctorReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function escapeMarkdown(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "\\|")
    .replaceAll("`", "\\`")
    .replaceAll("\n", " ");
}

export function reportToMarkdown(report: DoctorReport): string {
  const lines = [
    "# Schema Refactor Doctor Report", "", `Generated: ${report.generatedAt}`, "",
    `Errors: ${report.summary.error} | Warnings: ${report.summary.warning} | Info: ${report.summary.info}`, "",
    "| Severity | Rule | File | Location | Finding |", "|---|---|---|---|---|"
  ];
  for (const item of report.findings) lines.push(`| ${item.severity} | ${item.ruleId} | ${escapeMarkdown(item.filePath || "Vault")} | ${escapeMarkdown(item.structuralPath?.join(" > ") ?? "-")} | ${escapeMarkdown(item.message)} |`);
  return `${lines.join("\n")}\n`;
}
