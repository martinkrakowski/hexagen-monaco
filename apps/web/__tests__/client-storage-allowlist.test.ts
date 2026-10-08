import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

interface DiscoveredKey {
  key: string;
  file: string;
  line: number;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

// The whole web app (minus SKIP_DIRS), so a new top-level folder is covered
// without anyone remembering to add it here, and the packages that persist.
const SCAN_DIRS = [
  "apps/web",
  "packages/web-driver/src",
  "packages/shared/src",
  "packages/local-llm/src",
  "packages/manifest-generation/src",
  "packages/model-settings/src",
];

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".next",
  ".turbo",
  "coverage",
  "public",
  "__tests__",
  "__test__",
]);

// Strings the scan discovers that are NOT browser storage keys.
const NOT_STORAGE_KEYS = new Set([
  "byok:", // internal Map key prefix, not a localStorage/IDB key
]);

// Every key the brief's inventory says discovery must find (verified on main).
const INVENTORY_KEYS = [
  "hexagen:saved-projects",
  "hexagen:saved-projects-owner",
  "hexagen:workspace:",
  "hexagen:generation:",
  "hexagen:chat-history",
  "hexagen:governance:",
  "hexagen:wizard-draft:",
  "hexagen-active-workspace",
  "hexagen-brownfield-draft",
  "hexagen-canvas-layout-",
  "hexagen-active-tenant",
  "execution-engine-storage",
  "preferred-llm-storage",
  "hexagen:local-llm:last-model",
  "hexagen:local-llm:auto-load",
  "hexagen:local-llm:has-enabled",
  "hexagen:manifest-flow:cloud-provider",
  "hexagen:manifest-flow:remember-api-key",
  "hexagen:manifest-flow:skip-ai-setup",
  "hexagen:manifest-flow:remember-choice",
  "hexagen:local-llm:cache-metadata:",
  "hexagen:model-verification-cache",
  "hexagen:migration:status",
  "hexagen:persistence-domain:migrated:",
  "monaco-session-",
  "hexagen-saved-projects",
  "hexagen-wizard-draft",
  "hexagen-editor-workspace-",
  "byok:keys",
  "hexagen:vault:encrypted-payload",
  "hexagen-theme",
  "hexagen-workspace-layout-v1",
  "hexagen-plan-workbench-v1",
  "import_spec_content",
  "import_spec_original_content",
  "hexagen:local-llm:hardware-profile",
];

function isKeyVarName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("key") || lower.includes("prefix") || lower.endsWith("_id")
  );
}

function isStorageKeyValue(value: string): boolean {
  return (
    value.startsWith("hexagen:") ||
    value.startsWith("hexagen-") ||
    value.startsWith("monaco-") ||
    value.startsWith("byok:") ||
    value.startsWith("import_spec_") ||
    value.endsWith("-storage")
  );
}

function findSourceFiles(): string[] {
  const files: string[] = [];
  for (const dir of SCAN_DIRS) {
    const fullPath = path.join(REPO_ROOT, dir);
    if (fs.existsSync(fullPath)) walk(fullPath, files);
  }
  return files;
}

function walk(dir: string, files: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, files);
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.(test|spec)\.(ts|tsx)$/.test(entry.name) &&
      !/\.d\.ts$/.test(entry.name)
    ) {
      files.push(full);
    }
  }
}

const lineAt = (content: string, idx: number): number =>
  content.slice(0, idx).split("\n").length;

export function discoverStorageKeys(): DiscoveredKey[] {
  const found: DiscoveredKey[] = [];
  for (const file of findSourceFiles()) {
    const content = fs.readFileSync(file, "utf-8");
    const rel = path.relative(REPO_ROOT, file);
    let m: RegExpExecArray | null;

    // Pattern A: KEY/PREFIX/_ID variable assignment
    const vp =
      /\b(?:const|let|var|private\s+static|private|public\s+static|public|static)\s+([A-Za-z_$][\w$]*)\s*=\s*["']([^"'\n]+)["']/g;
    while ((m = vp.exec(content)) !== null) {
      if (isKeyVarName(m[1]) && isStorageKeyValue(m[2])) {
        found.push({ key: m[2], file: rel, line: lineAt(content, m.index) });
      }
    }

    // Pattern B: persist({ name: "..." })
    const pp = /\bpersist\s*\([\s\S]*?\bname\s*:\s*["']([^"']+)["']/g;
    while ((m = pp.exec(content)) !== null) {
      found.push({ key: m[1], file: rel, line: lineAt(content, m.index) });
    }

    // Pattern C: autoSaveId="literal"
    const asStr = /autoSaveId\s*=\s*["']([^"']+)["']/g;
    while ((m = asStr.exec(content)) !== null) {
      found.push({ key: m[1], file: rel, line: lineAt(content, m.index) });
    }

    // Pattern C2: autoSaveId={ ... "literal" ... }
    const asBlock = /autoSaveId\s*=\s*\{([\s\S]*?)\}/g;
    while ((m = asBlock.exec(content)) !== null) {
      const blockStart = m.index + m[0].length - m[1].length;
      const sp = /["']([^"'\n]+)["']/g;
      let sm: RegExpExecArray | null;
      while ((sm = sp.exec(m[1])) !== null) {
        found.push({
          key: sm[1],
          file: rel,
          line: lineAt(content, blockStart + sm.index),
        });
      }
    }

    // Pattern D: Direct localStorage/sessionStorage calls with string literal
    const sp =
      /\b(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\s*\(\s*["']([^"']+)["']/g;
    while ((m = sp.exec(content)) !== null) {
      found.push({ key: m[1], file: rel, line: lineAt(content, m.index) });
    }

    // Pattern E: Template literal prefix used as a storage key
    // E1: assigned to a KEY/PREFIX/_ID variable
    const e1 =
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*`([a-z][\w-]*(?:[:]|\-))\$\{/g;
    while ((m = e1.exec(content)) !== null) {
      if (isKeyVarName(m[1]) && isStorageKeyValue(m[2])) {
        found.push({ key: m[2], file: rel, line: lineAt(content, m.index) });
      }
    }
    // E2: directly in a localStorage/sessionStorage call
    const e2 =
      /\b(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\s*\(\s*`([a-z][\w-]*(?:[:]|\-))\$\{/g;
    while ((m = e2.exec(content)) !== null) {
      found.push({ key: m[1], file: rel, line: lineAt(content, m.index) });
    }

    // Pattern F: Object property values in const VAR_KEY/PREFIX = { PROP: "value", ... }
    const objPat = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g;
    while ((m = objPat.exec(content)) !== null) {
      if (isKeyVarName(m[1])) {
        const braceStart = content.indexOf("{", m.index);
        let depth = 1;
        let j = braceStart + 1;
        while (j < content.length && depth > 0) {
          if (content[j] === "{") depth++;
          else if (content[j] === "}") depth--;
          if (depth === 0) break;
          j++;
        }
        if (depth === 0) {
          const body = content.slice(braceStart + 1, j);
          const propPat = /\b([A-Za-z_$][\w$]*)\s*:\s*["']([^"'\n]+)["']/g;
          let pm: RegExpExecArray | null;
          while ((pm = propPat.exec(body)) !== null) {
            if (isStorageKeyValue(pm[2])) {
              found.push({
                key: pm[2],
                file: rel,
                line: lineAt(content, braceStart + 1 + pm.index),
              });
            }
          }
        }
      }
    }
  }
  return found.filter((f) => !NOT_STORAGE_KEYS.has(f.key));
}

// User data that must have a server store when the migration is done.
// If any of these keys vanished, the user would lose work.
export const DATA_KEYS = [
  "hexagen:saved-projects", // IDB: array of saved projects (idb-saved-projects.adapter.ts)
  "hexagen:workspace:", // IDB: editor workspace state per sessionId (idb-editor-workspace.adapter.ts)
  "hexagen:governance:", // IDB: governance assistant thread entries per context (idb-chat-persistence.adapter.ts)
  "hexagen-brownfield-draft", // localStorage: brownfield flow draft (brownfield-draft.ts KEY_PREFIX)
  "hexagen-canvas-layout-", // localStorage: canvas node positions per sessionId (local-storage-canvas-layout.adapter.ts)
] as const;

// Settings, caches, bookkeeping and legacy keys that stay in the browser
// or are scheduled for removal.
export const PREFERENCE_KEYS = [
  "hexagen:saved-projects-owner", // IDB: cache bookkeeping (idb-saved-projects.adapter.ts)
  "hexagen:generation:", // IDB: generation-result cache (idb-generation-result.adapter.ts)
  "hexagen:chat-history", // IDB: chat history (idb-chat-persistence.adapter.ts)
  "hexagen:wizard-draft:", // IDB: wizard draft, legacy / scheduled for removal (idb-wizard-draft.adapter.ts)
  "hexagen-active-workspace", // localStorage: duplicate of project data, scheduled for removal (ActiveWorkspaceContext.tsx)
  "hexagen-theme", // localStorage: UI theme preference (useTheme.tsx)
  "hexagen-active-tenant", // localStorage: active tenant selection (active-tenant.ts)
  "execution-engine-storage", // zustand persist: execution engine override (useExecutionEngine.ts)
  "preferred-llm-storage", // zustand persist: preferred LLM model (usePreferredLLM.ts)
  "hexagen:local-llm:last-model", // localStorage: last used local model (model-preference-keys.ts)
  "hexagen:local-llm:auto-load", // localStorage: auto-load local models flag (model-preference-keys.ts)
  "hexagen:local-llm:has-enabled", // localStorage: has-enabled-local-models flag (model-preference-keys.ts)
  "hexagen:manifest-flow:cloud-provider", // localStorage: cloud provider choice (model-preference-keys.ts)
  "hexagen:manifest-flow:remember-api-key", // localStorage: remember API key flag (model-preference-keys.ts)
  "hexagen:manifest-flow:skip-ai-setup", // localStorage: skip AI setup flag (model-preference-keys.ts)
  "hexagen:manifest-flow:remember-choice", // localStorage: remember choice flag (model-preference-keys.ts)
  "hexagen:local-llm:cache-metadata:", // localStorage: model cache metadata prefix (model-preference-keys.ts)
  "hexagen:model-verification-cache", // localStorage: model verification result cache (model-verification-cache.adapter.ts)
  "hexagen:migration:status", // localStorage: migration orchestrator status (migration-orchestrator.ts)
  "hexagen:persistence-domain:migrated:", // localStorage: migration flag prefix (persistence-domain-registry.ts)
  "monaco-session-", // localStorage: Monaco editor session state (local-storage-monaco.adapter.ts)
  "hexagen-saved-projects", // localStorage: legacy saved-projects migration source (saved-projects-migration-step.ts)
  "hexagen-wizard-draft", // localStorage: legacy wizard-draft migration source (wizard-draft-migration-step.ts)
  "hexagen-editor-workspace-", // localStorage: legacy editor-workspace migration source (editor-workspace-migration-step.ts)
  "byok:keys", // localStorage: BYOK provider entries (local-storage-byok-store.adapter.ts)
  "hexagen:vault:encrypted-payload", // localStorage: encrypted API key vault (encrypted-session-vault.adapter.ts)
  "hexagen-workspace-layout-v1", // localStorage: react-resizable-panels autoSaveId (constants.ts)
  "hexagen-plan-workbench-v1", // localStorage: react-resizable-panels autoSaveId (constants.ts)
  "manifest-preview-layout", // localStorage: react-resizable-panels autoSaveId (ManifestPreview.tsx)
  "manifest-preview-layout-ai", // localStorage: react-resizable-panels autoSaveId with AI column (ManifestPreview.tsx)
  "import_spec_content", // sessionStorage: spec text in transit between pages (ImportProjectSpecPage.tsx)
  "import_spec_original_content", // sessionStorage: original spec text in transit (ImportProjectSpecPage.tsx)
  "hexagen:local-llm:hardware-profile", // sessionStorage: hardware detection cache (useHardwareDetection.ts)
] as const;

describe("client storage allow-list", () => {
  it("discovers known storage keys", () => {
    const keys = new Set(discoverStorageKeys().map((k) => k.key));
    assert.ok(
      keys.has("hexagen:saved-projects"),
      "discover hexagen:saved-projects",
    );
    assert.ok(
      keys.has("preferred-llm-storage"),
      "discover preferred-llm-storage",
    );
  });

  it("discovers every key in the inventory", () => {
    const found = discoverStorageKeys();
    const seen = new Set(found.map((k) => k.key));
    for (const key of INVENTORY_KEYS) {
      assert.ok(
        seen.has(key),
        `inventory key "${key}" was not discovered by the source scan`,
      );
    }
  });

  it("every discovered key is classified as DATA or PREFERENCE", () => {
    const found = discoverStorageKeys();
    const seen = new Set<string>();
    for (const f of found) {
      if (seen.has(f.key)) continue;
      seen.add(f.key);
      const inData = DATA_KEYS.includes(f.key as (typeof DATA_KEYS)[number]);
      const inPref = PREFERENCE_KEYS.includes(
        f.key as (typeof PREFERENCE_KEYS)[number],
      );
      assert.ok(
        inData || inPref,
        `Unclassified storage key "${f.key}" found at ${f.file}:${f.line} — ` +
          `it must be in exactly one of DATA_KEYS or PREFERENCE_KEYS`,
      );
      assert.ok(
        !(inData && inPref),
        `Key "${f.key}" is in BOTH DATA_KEYS and PREFERENCE_KEYS — must be in exactly one`,
      );
    }
  });

  it("has no stale entries in the classification lists", () => {
    const discovered = new Set(discoverStorageKeys().map((k) => k.key));
    for (const key of DATA_KEYS) {
      assert.ok(
        discovered.has(key),
        `stale DATA_KEYS entry: "${key}" is not found by discovery`,
      );
    }
    for (const key of PREFERENCE_KEYS) {
      assert.ok(
        discovered.has(key),
        `stale PREFERENCE_KEYS entry: "${key}" is not found by discovery`,
      );
    }
  });
});
