export * from "../domain/value-objects/index.js";
export * from "../domain/ports/index.js";
export * from "../domain/model-catalog.js";
export * from "../domain/cloud-provider-catalog.js";
export * from "../application/ports/in/index.js";
// HEX-022: `recommendModel` is a pure function over a HardwareProfile and the
// model catalog — no ports, no I/O — and it is the only reason a browser-side
// consumer would otherwise have to reach for the root barrel (which pulls in
// `infrastructure/`). Exposing it here keeps `/client` the complete
// browser-safe surface.
export * from "../application/use-cases/recommend-model.use-case.js";
