"use client";

export type PackageManager = "yarn" | "pnpm" | "bun";

interface PackageManagerSelectProps {
  value: PackageManager;
  onChange: (value: PackageManager) => void;
}

/**
 * Single select for the workspace package manager. The union type
 * flows through onChange so consumers get a narrow `PackageManager`
 * instead of a raw string.
 */
export function PackageManagerSelect({
  value,
  onChange,
}: PackageManagerSelectProps) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Package Manager
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as PackageManager)}
        className="w-full px-4 py-2 bg-background border border-input rounded-md"
      >
        <option value="yarn">Yarn</option>
        <option value="pnpm">PNPM</option>
        <option value="bun">Bun</option>
      </select>
    </div>
  );
}
