export type ReportPhase =
  | "01-blueprint"
  | "02-implementation"
  | "03-verification"
  | "04-remediation";

export const REPORT_PHASES: readonly ReportPhase[] = [
  "01-blueprint",
  "02-implementation",
  "03-verification",
  "04-remediation",
] as const;

export const isReportPhase = (value: string): value is ReportPhase =>
  (REPORT_PHASES as readonly string[]).includes(value);

export const nextPhase = (current: ReportPhase): ReportPhase | null => {
  const idx = REPORT_PHASES.indexOf(current);
  if (idx === -1 || idx === REPORT_PHASES.length - 1) return null;
  return REPORT_PHASES[idx + 1];
};
