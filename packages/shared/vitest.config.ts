// Re-exports the shared Vitest base (ADR-0044). See ../../vitest.shared.ts.
//
// Node environment throughout, deliberately. The one browser-facing module in
// this package (`model-preference-storage`) reads `window.localStorage`, but a
// jsdom environment would NOT make that suite more real: Node 24+ defines a
// global `localStorage` that throws without `--localstorage-file`, and Vitest's
// jsdom environment skips copying any window key `globalThis` already owns, so
// jsdom's store survives on CI's Node 22.7 and is shadowed by the throwing
// global on a newer local Node. The suite supplies the store explicitly
// instead — see the note at the top of that file.
export { default } from "../../vitest.shared";
