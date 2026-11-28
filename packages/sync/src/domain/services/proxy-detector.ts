// packages/sync/src/domain/services/proxy-detector.ts
//
// Domain-side injection contract for Proxy detection (Lane HXS1). Domain code
// must never import `node:*`, so the ability to detect a Proxy (via
// `util.types.isProxy`) is injected as this function type by the
// infrastructure layer (generators, the sync engine).

/**
 * Detects whether an untrusted value is a Proxy. Injected by the
 * infrastructure layer (typically `util.types.isProxy`); domain boundary
 * functions call it BEFORE any reflection (getPrototypeOf, descriptor reads,
 * `in`, `Array.isArray`, `.length`) on object or function values.
 */
export type IsProxyDetector = (value: unknown) => boolean;
