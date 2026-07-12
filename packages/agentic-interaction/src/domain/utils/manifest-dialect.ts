/**
 * Deterministic import of the Hexagen MANIFEST dialect — files authored as
 * `contexts:` (+ top-level `ports:` / `adapters:` / `planes:`) rather than the
 * pipeline's canonical `bounded_contexts:` shape.
 *
 * Why: these are the most structured, highest-intent import files (real
 * manifests), yet before this mapper they failed the structured-config shape
 * check and were routed to the LLM loose-spec conversion — nondeterministic,
 * slow, and lossy (the alvaro-ai import dropped its declared ports, adapters,
 * and planes entirely). Mapping the dialect here keeps such files on the fully
 * deterministic path.
 *
 * This module intentionally has NO imports so it can be pulled into a client
 * bundle (`detectInputMode` on the import-spec page must classify a file as
 * structured-config exactly when the server can map it) without dragging in
 * the staged-generation pipeline. Keep it free of heavy / server-only
 * dependencies — same constraint as `sanitize-pseudo-yaml`.
 */

interface DialectContext {
  name: string;
  path?: string;
  plane?: string;
  description?: string;
  responsibility?: string;
  responsibilities?: unknown;
  layers?: {
    application?: {
      ports?: { in?: string[]; out?: string[] };
      /** Sidecar: declared port descriptions (name → description), carried so
       * the pipeline doesn't re-derive a trivial one from the name (R16). */
      port_descriptions?: Record<string, string>;
    };
    infrastructure?: {
      adapters?: string[];
      /** Sidecar: declared bindings (adapter name → port), carried so the
       * pipeline honors the author's `implements` instead of re-inferring —
       * re-inference has no cross-context vocabulary and left every imported
       * adapter unbound on the alvaro-ai import (5× phantom R06 'UnnamedPort',
       * 11× real R14). */
      adapter_implements?: Record<string, string>;
    };
  };
  [key: string]: unknown;
}

interface DialectPort {
  name: string;
  path?: string;
  description?: unknown;
  [key: string]: unknown;
}

interface DialectAdapter {
  name: string;
  context?: string;
  implements?: string;
  [key: string]: unknown;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function namedObjects<T extends { name: string }>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is T =>
      entry !== null &&
      typeof entry === "object" &&
      isNonEmptyString((entry as { name?: unknown }).name),
  );
}

/**
 * True when the parsed document is the manifest dialect: no usable
 * `bounded_contexts`, but a non-empty `contexts:` array of named objects.
 * Shared by `detectInputMode` (client routing) and `parseStructuredConfig`
 * (server mapping) so the two can never disagree about the same file.
 */
export function isManifestDialect(parsed: unknown): boolean {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }
  const obj = parsed as Record<string, unknown>;
  if (Array.isArray(obj.bounded_contexts) && obj.bounded_contexts.length > 0) {
    return false;
  }
  return namedObjects(obj.contexts).length > 0;
}

/**
 * Direction heuristic for a dialect port that no adapter implements. The
 * dialect's top-level `ports:` block declares driven interfaces in every
 * observed authoring style ("interfaces that Core depends on"), so `out` is
 * the default; only an unmistakably driving name (command/query naming) maps
 * to `in`.
 */
function isInboundish(name: string): boolean {
  return (
    /(Command|Query)Port$/i.test(name) ||
    /^(Get|Find|List|View)[A-Z]/.test(name)
  );
}

/**
 * Map the manifest dialect onto the canonical structured-config shape.
 * Returns the input unchanged when it isn't the dialect (total function — safe
 * to call on every parsed document). Never mutates the input.
 *
 * Mapping rules:
 * - `contexts:` (named objects) → `bounded_contexts:`; `project` falls back to
 *   the top-level `name:` / `displayName:`.
 * - A context's `responsibilities:` list (dialect) joins into the canonical
 *   `responsibility` string when one isn't set — classification quality.
 * - Top-level `ports:` are assigned to their OWNING context by `path` prefix
 *   match against each context's `path:` (longest match wins, so nested
 *   context paths resolve correctly). Ownership is never guessed from an
 *   adapter's context (the implementing side, not the owner). Direction:
 *   `out` when any adapter implements it (driven), else the name heuristic
 *   above. A port with no `path`, or a path under no context, is NOT silently
 *   dropped — it is retained under the top-level `ports:` block of the
 *   converted spec (visible on the review screen for the user to correct),
 *   just not attached to a context.
 * - Top-level `adapters:` (`{name, context, implements}`) append to the named
 *   context's `layers.infrastructure.adapters`, and the explicit `implements`
 *   is carried in the `adapter_implements` sidecar so the pipeline honors the
 *   author's binding instead of re-inferring it (re-inference is same-context
 *   name containment only — it left every alvaro-ai adapter unbound). When the
 *   implemented port is owned by a DIFFERENT context (the classic hexagonal
 *   shape: infra context implements a core-owned port), the port name is also
 *   seeded into the implementing context's `out` slot so the binding resolves
 *   locally — the shared name across contexts then surfaces through the
 *   single-ownership advisory (#402), which is the designed signal for this
 *   pattern, instead of dying as an unbindable reference. An adapter whose
 *   `context` matches no context (or is absent) is retained under top-level
 *   `adapters:` rather than dropped.
 * - Port `description:` strings are carried in the `port_descriptions` sidecar
 *   (the canonical layers hold name strings only), so review findings quote the
 *   author's own words rather than a name-derived stub (R16).
 * - The array-form `planes:` block (objects with name/description/color) is
 *   dropped — per-context `plane:` strings carry the signal downstream; the
 *   canonical map form passes through for normalizeDialect's shared-kernel
 *   mapping. Extra manifest-only blocks (`models:`, `branding:`, `defaults:`,
 *   …) pass through untouched; the pipeline reads only canonical fields.
 */
export function mapManifestDialect(parsed: unknown): unknown {
  if (!isManifestDialect(parsed)) return parsed;
  const obj = parsed as Record<string, unknown>;

  const contexts: DialectContext[] = namedObjects<DialectContext>(
    obj.contexts,
  ).map((ctx) => ({ ...ctx }));
  const ports = namedObjects<DialectPort>(obj.ports);
  const adapters = namedObjects<DialectAdapter>(obj.adapters);
  const implementedPortNames = new Set(
    adapters.map((a) => a.implements).filter(isNonEmptyString),
  );

  const normalizeName = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Author descriptions for every declared port, used both by the owning
  // context and by any implementing context a port gets seeded into below.
  const portDescByName = new Map<string, string>(
    ports.flatMap((p) =>
      isNonEmptyString(p.description)
        ? [[p.name, p.description.trim()] as const]
        : [],
    ),
  );

  for (const ctx of contexts) {
    // Dialect `responsibilities:` list → canonical `responsibility` string.
    if (!isNonEmptyString(ctx.responsibility)) {
      const items = Array.isArray(ctx.responsibilities)
        ? ctx.responsibilities.filter(isNonEmptyString)
        : [];
      if (items.length > 0) ctx.responsibility = items.join("; ");
    }
  }

  // Ports → owning context by longest path-prefix match. Unmatched ports are
  // preserved (see below), never silently dropped.
  const unmatchedPorts: DialectPort[] = [];
  for (const port of ports) {
    let owner: DialectContext | undefined;
    let ownerPathLength = -1;
    if (isNonEmptyString(port.path)) {
      for (const ctx of contexts) {
        if (!isNonEmptyString(ctx.path)) continue;
        const ctxPath = ctx.path.replace(/\/+$/, "");
        if (
          (port.path === ctxPath || port.path.startsWith(`${ctxPath}/`)) &&
          ctxPath.length > ownerPathLength
        ) {
          owner = ctx;
          ownerPathLength = ctxPath.length;
        }
      }
    }
    if (!owner) {
      unmatchedPorts.push(port);
      continue;
    }

    const direction =
      !implementedPortNames.has(port.name) && isInboundish(port.name)
        ? "in"
        : "out";
    const existing = owner.layers?.application?.ports;
    const slot = new Set(existing?.[direction] ?? []);
    slot.add(port.name);
    // Carry the author's port description (sidecar) — the canonical ports slots
    // are name-only, and losing this produced name-derived stubs that Stage 6
    // then flagged as trivial (R16) against the author's own input.
    const descriptions = {
      ...owner.layers?.application?.port_descriptions,
      ...(isNonEmptyString(port.description)
        ? { [port.name]: port.description.trim() }
        : {}),
    };
    owner.layers = {
      ...owner.layers,
      application: {
        ...owner.layers?.application,
        ports: {
          in: direction === "in" ? [...slot] : (existing?.in ?? []),
          out: direction === "out" ? [...slot] : (existing?.out ?? []),
        },
        ...(Object.keys(descriptions).length > 0
          ? { port_descriptions: descriptions }
          : {}),
      },
    };
  }

  // Adapters → their declared context's infrastructure layer (by normalized
  // name, tolerant of casing/kebab variants). Unmatched adapters are preserved.
  const unmatchedAdapters: DialectAdapter[] = [];
  for (const adapter of adapters) {
    const target = isNonEmptyString(adapter.context)
      ? contexts.find(
          (ctx) => normalizeName(ctx.name) === normalizeName(adapter.context!),
        )
      : undefined;
    if (!target) {
      unmatchedAdapters.push(adapter);
      continue;
    }
    const existing = target.layers?.infrastructure?.adapters ?? [];
    if (existing.includes(adapter.name)) continue;
    // Carry the author's declared binding (sidecar). The canonical adapters
    // slot is name-only, and dropping `implements` forced same-context name
    // re-inference downstream, which cannot express the dialect's declared
    // cross-context bindings.
    const declaredImplements = isNonEmptyString(adapter.implements)
      ? adapter.implements.trim()
      : undefined;
    const bindings = {
      ...target.layers?.infrastructure?.adapter_implements,
      ...(declaredImplements ? { [adapter.name]: declaredImplements } : {}),
    };
    target.layers = {
      ...target.layers,
      infrastructure: {
        ...target.layers?.infrastructure,
        adapters: [...existing, adapter.name],
        ...(Object.keys(bindings).length > 0
          ? { adapter_implements: bindings }
          : {}),
      },
    };
    // The declared port may be owned by a DIFFERENT context (infra implements a
    // core-owned port — the classic hexagonal shape). Seed the port name into
    // the implementing context's own `out` slot so the binding resolves in its
    // context's port map; the duplicated name across contexts then surfaces via
    // the single-ownership advisory (#402) — the designed signal — instead of
    // the binding dying as an unresolvable reference.
    if (declaredImplements) {
      const ownPorts = target.layers?.application?.ports;
      const alreadyLocal =
        (ownPorts?.in ?? []).includes(declaredImplements) ||
        (ownPorts?.out ?? []).includes(declaredImplements);
      if (!alreadyLocal) {
        const seededDesc = portDescByName.get(declaredImplements);
        const descriptions = {
          ...target.layers?.application?.port_descriptions,
          ...(seededDesc ? { [declaredImplements]: seededDesc } : {}),
        };
        target.layers = {
          ...target.layers,
          application: {
            ...target.layers?.application,
            ports: {
              in: ownPorts?.in ?? [],
              out: [...(ownPorts?.out ?? []), declaredImplements],
            },
            ...(Object.keys(descriptions).length > 0
              ? { port_descriptions: descriptions }
              : {}),
          },
        };
      }
    }
  }

  const rest: Record<string, unknown> = { ...obj };
  delete rest.contexts;
  // Retain any ports/adapters we could NOT attach to a context (no path / no
  // matching context) rather than deleting the whole block — otherwise a
  // user-declared port/adapter would vanish silently before Stage 3/4. The
  // pipeline reads ports/adapters from context layers, so these top-level
  // remnants don't generate, but they stay visible in the converted spec for
  // the user to correct. All-matched inputs (the common case) leave both empty,
  // so the blocks are removed and the output is unchanged (qodo #409).
  if (unmatchedPorts.length > 0) rest.ports = unmatchedPorts;
  else delete rest.ports;
  if (unmatchedAdapters.length > 0) rest.adapters = unmatchedAdapters;
  else delete rest.adapters;
  // Only the dialect's ARRAY form of `planes:` (objects with name/description/
  // color) is dropped — per-context `plane:` strings carry the signal. The
  // canonical MAP form (`planes: { shared-kernel: [...] }`) must pass through:
  // normalizeDialect reads it for the shared-kernel type mapping.
  if (Array.isArray(rest.planes)) delete rest.planes;

  const project =
    (isNonEmptyString(obj.project) && obj.project) ||
    (isNonEmptyString(obj.name) && obj.name) ||
    (isNonEmptyString(obj.displayName) && obj.displayName) ||
    undefined;

  return {
    ...rest,
    ...(project !== undefined ? { project } : {}),
    bounded_contexts: contexts,
  };
}
