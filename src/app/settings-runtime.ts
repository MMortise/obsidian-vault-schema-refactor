export function resolveScanConcurrency(isMobile: boolean, lowResourceMode: boolean): number {
  return isMobile || lowResourceMode ? 2 : 8;
}
