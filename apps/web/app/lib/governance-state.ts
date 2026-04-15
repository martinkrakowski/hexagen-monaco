// apps/web/app/lib/governance-state.ts
// Module-level singleton for threading governance data between panels.
// page.tsx writes manifestYaml on generate.
// EditableMonaco writes openFileContent on every change.
// AIArchitectPanel reads both inside debounced refresh callbacks.

export const governanceState = {
  /** Current manifest YAML string, set by page.tsx after generate */
  currentManifestYaml: "",
  /** Content of the currently open file in the code editor */
  currentOpenFileContent: "",
};
