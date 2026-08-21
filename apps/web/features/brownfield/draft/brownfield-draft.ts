/**
 * Brownfield draft persistence (F-34) — the recoverable half of the flow.
 *
 * A refresh mid-ratification otherwise destroys everything the user confirmed
 * on S3–S5. This module makes that survivable, and it is deliberately built on
 * the EXISTING `createPersistedStorage<T>` in `app/lib/persisted-state.ts`
 * rather than on `localStorage` directly: that helper already owns the SSR
 * guard, the JSON parse, the schema hook and the try/catch that private-mode
 * and blocked-site-data browsers require (where touching `localStorage` at all
 * THROWS rather than returning null). Re-implementing any of that here would
 * mean re-implementing those four guarantees, badly.
 *
 * ## What a draft is — and is not
 *
 * A draft is RECOVERABLE USER INPUT. It is not a cache of server state.
 *
 * The distinction is load-bearing rather than stylistic, because the output of
 * this flow is a conformance artifact the user hands to a reviewer. Anything
 * restored from storage and then silently trusted has to be something the user
 * personally typed or confirmed; anything the server produced has to be
 * fetched again, because the repository it described may have moved on.
 *
 * So, against `BrownfieldFlowViewState` (BF-3.1 `BrownfieldFlow/types.ts`):
 *
 *   PERSISTED (user input)          DROPPED (server state / in-flight)
 *   ----------------------          ----------------------------------
 *   tier            — chosen        uploadedFileName — names an upload that
 *   repoUrl/repoRef — typed                            only exists server-side
 *   layoutDraft     — ratified      scanStageLabel   — a live stream label
 *   manifestDraft   — ratified      freshFindings    — a point-in-time scan
 *   baselinedFindingKeys — chosen   blockReason      — one run's outcome
 *   gateInstallMode — chosen        error            — one request's outcome
 *
 * Dropping `freshFindings` also disposes of the size problem that made the
 * plan reach for IndexedDB: findings lists run to hundreds of entries, but the
 * user's DECISION about them is `baselinedFindingKeys`, a short list of stable
 * keys. Keys re-apply cleanly against a freshly fetched findings list — a key
 * whose finding is gone simply does not match, which is the correct outcome —
 * whereas a persisted findings array would be a stale copy of the repository
 * presented to the user as current. localStorage is therefore the right store
 * for this payload and no IDB tier is needed.
 *
 * ## Versioning: discard and start clean, never partially apply
 *
 * A persisted draft outlives a deploy, so a blob written by an older build
 * WILL be read by a newer one. The decision here is that any draft whose
 * `schemaVersion` is not exactly `BROWNFIELD_DRAFT_SCHEMA_VERSION` — older,
 * newer, or missing — is DISCARDED WHOLE. There is no migration ladder and no
 * field-by-field salvage.
 *
 * The reason is the same one that governs what gets persisted at all. A partial
 * migration produces a draft that is structurally valid and semantically wrong:
 * a `layoutDraft` carrying half of an old shape, presented on a ratification
 * screen as though the user had confirmed it, ratified with one click, and
 * written into `layout.yaml`. Losing a draft costs the user one re-entry and is
 * visible immediately; silently mis-applying one is invisible and ends up in a
 * committed artifact. If a migration is ever genuinely worth writing it belongs
 * here as an explicit `schemaVersion === N` branch that produces a COMPLETE
 * current-shape draft or returns null — never as a permissive validator.
 *
 * The storage KEY deliberately carries no version, so a future build can still
 * see (and overwrite or purge) a v1 blob. Versioning by key would orphan stale
 * data in the user's browser forever instead.
 */
import type {
  BrownfieldFlowState,
  BrownfieldFlowViewState,
  BrownfieldGateInstallMode,
  BrownfieldLayoutDraft,
  BrownfieldManifestDraft,
  BrownfieldTier,
} from "../BrownfieldFlow/types";
import {
  createPersistedStorage,
  type PersistedStorage,
} from "@/lib/persisted-state";

/** Bump on ANY shape change. A mismatch discards the stored draft whole. */
export const BROWNFIELD_DRAFT_SCHEMA_VERSION = 1;

/**
 * Drafts older than this are treated as unrecognised and discarded. A draft
 * describes a repository as it was when it was scanned; a week later that is a
 * guess, and the point of the persist/drop split above is not to hand the user
 * a guess wearing the costume of something they confirmed.
 */
export const BROWNFIELD_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const KEY_PREFIX = "hexagen-brownfield-draft";

/**
 * The persisted payload. Every field is either something the user typed or
 * something the user chose; see the module header for what is excluded.
 */
export interface BrownfieldDraft {
  schemaVersion: number;
  /** The flow's `?name=` seed; cross-checked against the key on read. */
  seedName: string | null;
  /** Epoch ms of the last write — the TTL input, not display data. */
  savedAt: number;
  /** Where the user was. Clamped by `resolveResumeState` before it is used. */
  flowState: BrownfieldFlowState;
  tier: BrownfieldTier | null;
  repoUrl: string | null;
  repoRef: string | null;
  layoutDraft: BrownfieldLayoutDraft | null;
  manifestDraft: BrownfieldManifestDraft | null;
  baselinedFindingKeys: string[];
  gateInstallMode: BrownfieldGateInstallMode | null;
}

/**
 * One draft per flow seed, so a second brownfield run cannot inherit an
 * abandoned attempt's ratifications (the rule `genesisProjectSettingsStore`
 * already applies to the genesis form).
 *
 * The unnamed flow gets its own tagged slot rather than an empty suffix: `n:`
 * and `u` keep the mapping injective, so a project literally named
 * `__unnamed__` (or an empty string) cannot collide with the no-name slot.
 */
export function brownfieldDraftKey(seedName: string | null): string {
  const normalized = seedName?.trim() ?? "";
  return normalized ? `${KEY_PREFIX}:n:${normalized}` : `${KEY_PREFIX}:u`;
}

/** Normalises a seed the same way `brownfieldDraftKey` does. */
export function normalizeSeedName(seedName: string | null): string | null {
  return seedName?.trim() || null;
}

function isStringArray(candidate: unknown): candidate is string[] {
  return (
    Array.isArray(candidate) && candidate.every((v) => typeof v === "string")
  );
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === "object" && candidate !== null;
}

function isLayoutDraft(candidate: unknown): candidate is BrownfieldLayoutDraft {
  if (!isRecord(candidate)) return false;
  if (!Array.isArray(candidate.contexts)) return false;
  return candidate.contexts.every((entry) => {
    if (!isRecord(entry)) return false;
    if (typeof entry.packageRoot !== "string") return false;
    if (typeof entry.contextName !== "string") return false;
    if (!isRecord(entry.layerDirectories)) return false;
    return Object.values(entry.layerDirectories).every(isStringArray);
  });
}

function isManifestDraft(
  candidate: unknown,
): candidate is BrownfieldManifestDraft {
  if (!isRecord(candidate)) return false;
  if (typeof candidate.system !== "string") return false;
  if (typeof candidate.scope !== "string") return false;
  if (typeof candidate.architecture !== "string") return false;
  if (!Array.isArray(candidate.contexts)) return false;
  return candidate.contexts.every(
    (entry) =>
      isRecord(entry) &&
      typeof entry.name === "string" &&
      typeof entry.include === "boolean" &&
      typeof entry.type === "string" &&
      typeof entry.description === "string" &&
      isStringArray(entry.dependsOn),
  );
}

const FLOW_STATES: readonly BrownfieldFlowState[] = [
  "tier_pick",
  "uploading",
  "repo_entry",
  "scanning",
  "blocked",
  "layout_ratify",
  "manifest_ratify",
  "findings_review",
  "report",
  "gate_install",
];

const TIERS: readonly BrownfieldTier[] = ["artifacts", "clone", "zip"];

const GATE_MODES: readonly BrownfieldGateInstallMode[] = [
  "download-zip",
  "open-pr",
];

function isNullableString(candidate: unknown): candidate is string | null {
  return candidate === null || typeof candidate === "string";
}

/**
 * The schema hook handed to `createPersistedStorage`. Validation is STRICT and
 * deep, because a draft that passes here is later shown to the user as
 * something they confirmed and then written into `layout.yaml` /
 * `manifest.yaml`. A shallow guard would let a half-shaped nested object
 * through — the exact partially-applied outcome the versioning decision above
 * exists to prevent.
 */
export function isBrownfieldDraft(
  candidate: unknown,
): candidate is BrownfieldDraft {
  if (!isRecord(candidate)) return false;
  // Version first: an unrecognised version is discarded whole, so nothing
  // below it is even inspected, let alone salvaged.
  if (candidate.schemaVersion !== BROWNFIELD_DRAFT_SCHEMA_VERSION) return false;
  if (!isNullableString(candidate.seedName)) return false;
  if (
    typeof candidate.savedAt !== "number" ||
    !Number.isFinite(candidate.savedAt)
  ) {
    return false;
  }
  if (!FLOW_STATES.includes(candidate.flowState as BrownfieldFlowState)) {
    return false;
  }
  if (
    candidate.tier !== null &&
    !TIERS.includes(candidate.tier as BrownfieldTier)
  ) {
    return false;
  }
  if (!isNullableString(candidate.repoUrl)) return false;
  if (!isNullableString(candidate.repoRef)) return false;
  if (candidate.layoutDraft !== null && !isLayoutDraft(candidate.layoutDraft)) {
    return false;
  }
  if (
    candidate.manifestDraft !== null &&
    !isManifestDraft(candidate.manifestDraft)
  ) {
    return false;
  }
  if (!isStringArray(candidate.baselinedFindingKeys)) return false;
  if (
    candidate.gateInstallMode !== null &&
    !GATE_MODES.includes(candidate.gateInstallMode as BrownfieldGateInstallMode)
  ) {
    return false;
  }
  return true;
}

/**
 * Where a restored draft is allowed to put the user back.
 *
 * The rule: the deepest state whose screen renders ENTIRELY from persisted
 * input. Everything else falls back to the nearest such state, always
 * BACKWARDS — a restore never advances the user past a screen they have not
 * seen, and never lands them on one that would render empty.
 *
 *  - `uploading` / `scanning` — the upload and the scan are gone; there is
 *    nothing to resume, only something to redo. Back to the tier picker.
 *  - `blocked` — one run's failure, not user input. Back to the tier picker,
 *    which is where the machine's own recovery edge points anyway.
 *  - `findings_review` — the findings themselves are deliberately not
 *    persisted. Back to `manifest_ratify`, from which re-ratifying re-fetches
 *    them; the user's `baselinedFindingKeys` re-apply by key on arrival.
 *  - `report` / `gate_install` — hold a server-produced point-in-time artifact
 *    that is not persisted either. Same fallback, same reason.
 */
export function resumableStateFor(
  state: BrownfieldFlowState,
): BrownfieldFlowState {
  switch (state) {
    case "repo_entry":
      return "repo_entry";
    case "layout_ratify":
      return "layout_ratify";
    case "manifest_ratify":
    case "findings_review":
    case "report":
    case "gate_install":
      return "manifest_ratify";
    default:
      return "tier_pick";
  }
}

/**
 * `resumableStateFor` plus the content check: a screen is only resumable if
 * the draft it renders is actually there. Degrades one step at a time, so a
 * draft missing its manifest still resumes at the layout it does have.
 */
export function resolveResumeState(
  draft: BrownfieldDraft,
): BrownfieldFlowState {
  let target = resumableStateFor(draft.flowState);
  if (target === "manifest_ratify" && draft.manifestDraft === null) {
    target = "layout_ratify";
  }
  if (target === "layout_ratify" && draft.layoutDraft === null) {
    target = "tier_pick";
  }
  if (target === "repo_entry" && draft.tier !== "clone") {
    target = "tier_pick";
  }
  return target;
}

/** A blank draft for a seed — the shape a fresh flow starts from. */
export function emptyBrownfieldDraft(
  seedName: string | null,
  now: number = Date.now(),
): BrownfieldDraft {
  return {
    schemaVersion: BROWNFIELD_DRAFT_SCHEMA_VERSION,
    seedName: normalizeSeedName(seedName),
    savedAt: now,
    flowState: "tier_pick",
    tier: null,
    repoUrl: null,
    repoRef: null,
    layoutDraft: null,
    manifestDraft: null,
    baselinedFindingKeys: [],
    gateInstallMode: null,
  };
}

/**
 * Projects the flow's view state onto the persisted subset. This function IS
 * the persist/drop policy — `uploadedFileName`, `scanStageLabel`,
 * `freshFindings`, `blockReason` and `error` are dropped here by omission,
 * rather than filtered further downstream where a later edit could quietly
 * reintroduce them.
 */
export function toBrownfieldDraft(
  seedName: string | null,
  view: BrownfieldFlowViewState,
  now: number = Date.now(),
): BrownfieldDraft {
  return {
    schemaVersion: BROWNFIELD_DRAFT_SCHEMA_VERSION,
    seedName: normalizeSeedName(seedName),
    savedAt: now,
    flowState: view.state,
    tier: view.tier ?? null,
    repoUrl: view.repoUrl ?? null,
    repoRef: view.repoRef ?? null,
    layoutDraft: view.layoutDraft ?? null,
    manifestDraft: view.manifestDraft ?? null,
    baselinedFindingKeys: view.baselinedFindingKeys ?? [],
    gateInstallMode: view.gateInstallMode ?? null,
  };
}

/**
 * The restore direction: a draft back onto the flow's view state, with the
 * state clamped and the non-persisted fields explicitly nulled rather than
 * left `undefined`. The explicit nulls matter — a caller spreading this over a
 * live view state must not inherit a previous run's findings or scan label.
 */
export function fromBrownfieldDraft(
  draft: BrownfieldDraft,
): BrownfieldFlowViewState {
  return {
    state: resolveResumeState(draft),
    tier: draft.tier,
    repoUrl: draft.repoUrl,
    repoRef: draft.repoRef,
    layoutDraft: draft.layoutDraft,
    manifestDraft: draft.manifestDraft,
    baselinedFindingKeys: draft.baselinedFindingKeys,
    gateInstallMode: draft.gateInstallMode,
    // Not persisted — see the module header. Nulled explicitly so a caller
    // spreading this over a live view state clears them rather than inheriting
    // a previous run's values. (`error` and `blockReason` are BF-3.1's own
    // field names on `BrownfieldFlowViewState`; this is a flow slice, not one
    // of the prop-name-gated roots in scripts/validate-ui-boundary.sh.)
    uploadedFileName: null,
    scanStageLabel: null,
    freshFindings: null,
    blockReason: null,
    error: null,
  };
}

/**
 * A seed-keyed draft store: a memoised `PersistedStorage` plus the snapshot
 * cache `useSyncExternalStore` requires (`getSnapshot` must return a stable
 * reference or React re-renders forever).
 */
export interface BrownfieldDraftStore {
  key: string;
  /** Cached, TTL-checked read. Null for absent, unrecognised, or stale. */
  read: () => BrownfieldDraft | null;
  /** Stable server snapshot — always null. See the hook for why. */
  readServer: () => null;
  subscribe: (callback: () => void) => () => void;
  save: (draft: BrownfieldDraft) => void;
  /** Removes the stored draft. Also the purge path for unrecognised blobs. */
  clear: () => void;
}

const storeRegistry = new Map<string, BrownfieldDraftStore>();

/**
 * The store handed out during server render. Inert, shared, and NOT registered.
 *
 * `createPersistedStorage` is already SSR-safe (it no-ops when `window` is
 * undefined), so a real store would also work — but `storeRegistry` is
 * module-scoped and therefore shared by every request the Node process serves,
 * so keying it on a user-supplied project name server-side grows a map that is
 * never read (its every entry caches `null`) and never freed. One shared inert
 * object avoids that entirely, and its identity is stable, which is what
 * `useSyncExternalStore` needs of `subscribe`.
 */
const serverStore: BrownfieldDraftStore = {
  key: `${KEY_PREFIX}:ssr`,
  read: () => null,
  readServer: () => null,
  subscribe: () => () => {},
  save: () => {},
  clear: () => {},
};

function createStore(
  seedName: string | null,
  storageKey: string,
): BrownfieldDraftStore {
  const storage: PersistedStorage<BrownfieldDraft> =
    createPersistedStorage<BrownfieldDraft>(storageKey, isBrownfieldDraft);

  let cached: BrownfieldDraft | null = null;
  let cacheFilled = false;

  function readThrough(): BrownfieldDraft | null {
    // `storage.read()` already returns null (rather than throwing) for SSR,
    // absent keys, unparseable JSON, a failed `isBrownfieldDraft`, AND a
    // browser whose `localStorage` access throws outright.
    const stored = storage.read();
    if (stored === null) return null;
    // Belt and braces: a draft found under a key it does not claim means the
    // key derivation drifted between builds. Treat it as unrecognised.
    if (stored.seedName !== normalizeSeedName(seedName)) return null;
    if (Date.now() - stored.savedAt > BROWNFIELD_DRAFT_MAX_AGE_MS) return null;
    return stored;
  }

  const store: BrownfieldDraftStore = {
    key: storageKey,
    read() {
      if (!cacheFilled) {
        cached = readThrough();
        cacheFilled = true;
      }
      return cached;
    },
    readServer: () => null,
    subscribe(callback) {
      return storage.subscribe(() => {
        cacheFilled = false;
        callback();
      });
    },
    save(draft) {
      storage.write(draft);
      // Invalidate directly too: `write` only notifies SUBSCRIBERS, so an
      // unsubscribed caller would otherwise keep serving a stale snapshot.
      cacheFilled = false;
    },
    clear() {
      storage.write(null);
      cacheFilled = false;
    },
  };
  return store;
}

/**
 * Returns the store for a seed, memoised by key.
 *
 * The memoisation is REQUIRED, not an optimisation: `createPersistedStorage`
 * keys its listener set by the storage object's identity, so two independently
 * created storages for the same key would never notify each other and two
 * components on the same draft would silently diverge.
 */
export function getBrownfieldDraftStore(
  seedName: string | null,
): BrownfieldDraftStore {
  if (typeof window === "undefined") return serverStore;
  const storageKey = brownfieldDraftKey(seedName);
  const existing = storeRegistry.get(storageKey);
  if (existing) return existing;
  const created = createStore(seedName, storageKey);
  storeRegistry.set(storageKey, created);
  return created;
}

/** Test seam: drops the memoised stores (and their snapshot caches). */
export function resetBrownfieldDraftStores(): void {
  storeRegistry.clear();
}
