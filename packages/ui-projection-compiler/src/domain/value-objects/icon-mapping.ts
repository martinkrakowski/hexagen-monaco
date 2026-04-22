export interface IconMapping {
  readonly logicalName: string;
  readonly lucideIcon: string;
  readonly color: string;
}

export const DEFAULT_ICON_MAPPINGS: ReadonlyArray<IconMapping> = [
  { logicalName: "aggregate", lucideIcon: "Package", color: "text-amber-500" },
  { logicalName: "valueObject", lucideIcon: "Gem", color: "text-emerald-500" },
  { logicalName: "event", lucideIcon: "Zap", color: "text-violet-500" },
  { logicalName: "service", lucideIcon: "Settings2", color: "text-sky-500" },
] as const;

export function findIconMapping(
  mappings: ReadonlyArray<IconMapping>,
  logicalName: string,
): IconMapping | null {
  return mappings.find((m) => m.logicalName === logicalName) ?? null;
}
