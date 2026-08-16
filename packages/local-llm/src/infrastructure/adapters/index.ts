// NOTE: `./cloud-provider-routing.js` is deliberately NOT re-exported here.
// This barrel is reached from the package root (src/index.ts ->
// infrastructure/index.ts -> here), and 26 "use client" modules import that
// root — so anything exported here is client-reachable, and this package
// declares no `sideEffects: false` to let a bundler prove the constants away.
// The routing table has no consumer today; when a server-side one appears it
// should deep-import the module (or get its own `./server` subpath), not ride
// in on the browser-facing barrel. See ADR-0051.
export * from "./webllm.adapter.js";
export * from "./webgpu-capability.adapter.js";
export * from "./browser-hardware-profiler.adapter.js";
export * from "./idb-chat-persistence.adapter.js";
