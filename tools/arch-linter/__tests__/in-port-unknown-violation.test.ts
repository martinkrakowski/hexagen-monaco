/**
 * `in-port-unknown` — the pure predicates (D4, lane H4).
 *
 * Every title states the behaviour it pins; the bodies prove it by asserting
 * on emitted violations (rule / specifier / message), not on file contents:
 *  - scope refusals (non-in-port paths, non-exported symbols, test/template
 *    files) return [] — a rule that fired on those would be noise;
 *  - the three `unknown` shapes (direct parameter, alias-resolved parameter,
 *    call-signature alias) each emit exactly one violation;
 *  - typed/`Validated` parameters emit nothing (no false positives);
 *  - cyclic aliases and malformed/untyped parameters terminate and never
 *    throw (the hostile-AST contract).
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { Project } from "ts-morph";
import {
  IN_PORT_UNKNOWN_RULE,
  checkInPortUnknown,
  isInPortFile,
} from "../src/in-port-unknown-violation.js";

/** Parse a snippet into a real ts-morph SourceFile — no filesystem, no tsconfig. */
function sourceFile(filePath: string, code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(filePath, code);
}

const UNKNOWN_METHOD = `export interface ThingPort { run(req: unknown): Promise<void>; }`;

describe("isInPortFile", () => {
  it("ignores files outside ports/in and non-exported interfaces", () => {
    // Path scope first: a file is checkable ONLY under /ports/in/.
    assert.equal(isInPortFile("/ctx/src/domain/thing.ts"), false);
    assert.equal(
      isInPortFile("/ctx/src/application/ports/out/thing.port.ts"),
      false,
    );
    assert.equal(isInPortFile("/ctx/src/application/ports/in/thing.js"), false);
    // Windows separators normalize.
    assert.equal(
      isInPortFile("C:\\ctx\\src\\application\\ports\\in\\thing.port.ts"),
      true,
    );

    // Behaviour scope: an exported interface with an `unknown` parameter is
    // NOT flagged when the file is outside ports/in…
    const outSide = sourceFile(
      "/ctx/src/application/ports/out/thing.port.ts",
      UNKNOWN_METHOD,
    );
    assert.deepEqual(checkInPortUnknown(outSide), []);
    // …nor when it is in ports/in but NOT exported.
    const notExported = sourceFile(
      "/ctx/src/application/ports/in/hidden.port.ts",
      `interface HiddenPort { run(req: unknown): Promise<void>; }`,
    );
    assert.deepEqual(checkInPortUnknown(notExported), []);
  });

  it("ignores test and template files inside ports/in", () => {
    const cases: Array<[string, string]> = [
      ["/ctx/src/application/ports/in/thing.port.test.ts", UNKNOWN_METHOD],
      ["/ctx/src/application/ports/in/thing.port.spec.ts", UNKNOWN_METHOD],
      ["/ctx/src/application/ports/in/thing.port.test.tsx", UNKNOWN_METHOD],
      ["/ctx/src/application/ports/__tests__/thing.port.ts", UNKNOWN_METHOD],
      ["/ctx/src/application/ports/templates/thing.port.ts", UNKNOWN_METHOD],
      // Ambient declarations are excluded even though they end with `.ts`.
      ["/ctx/src/application/ports/in/thing.port.d.ts", UNKNOWN_METHOD],
    ];
    for (const [filePath, code] of cases) {
      const file = sourceFile(filePath, code);
      // Precondition: the path really is under ports/in — the refusal comes
      // from the test/template/.d.ts guard, not from the directory check.
      assert.match(filePath, /\/ports\/in\/|__tests__|templates/);
      assert.deepEqual(
        checkInPortUnknown(file),
        [],
        `expected ${filePath} to be ignored`,
      );
    }
  });

  it("checks both .port.ts and .in-port.ts files under ports/in", () => {
    const port = sourceFile(
      "/ctx/src/application/ports/in/thing.port.ts",
      UNKNOWN_METHOD,
    );
    const inPort = sourceFile(
      "/ctx/src/application/ports/in/other.in-port.ts",
      `export interface OtherInPort { send(req: unknown): Promise<void>; }`,
    );
    assert.equal(
      isInPortFile("/ctx/src/application/ports/in/thing.port.ts"),
      true,
    );
    assert.equal(
      isInPortFile("/ctx/src/application/ports/in/other.in-port.ts"),
      true,
    );

    const portViolations = checkInPortUnknown(port);
    assert.equal(portViolations.length, 1);
    assert.equal(portViolations[0]?.specifier, "ThingPort.run:req");

    const inPortViolations = checkInPortUnknown(inPort);
    assert.equal(inPortViolations.length, 1);
    assert.equal(inPortViolations[0]?.specifier, "OtherInPort.send:req");
  });
});

describe("checkInPortUnknown — violations", () => {
  it("flags an exported in-port interface method with a parameter typed unknown", () => {
    const file = sourceFile(
      "/ctx/src/application/ports/in/thing.port.ts",
      UNKNOWN_METHOD,
    );
    const violations = checkInPortUnknown(file);
    assert.equal(violations.length, 1);
    const v = violations[0];
    assert.ok(v, "expected exactly one violation");
    assert.equal(v.rule, IN_PORT_UNKNOWN_RULE);
    assert.equal(v.rule, "in-port-unknown");
    assert.equal(v.specifier, "ThingPort.run:req");
    // The message names the interface, the method, the parameter and the file.
    assert.match(v.message, /ThingPort/);
    assert.match(v.message, /\brun\b/);
    assert.match(v.message, /\breq\b/);
    assert.match(v.message, /thing\.port\.ts/);
  });

  it("flags an exported in-port interface method whose request type alias resolves to unknown", () => {
    const file = sourceFile(
      "/ctx/src/application/ports/in/request.port.ts",
      `export type MyReq = unknown;
export interface MyInPort { run(req: MyReq): Promise<void>; }`,
    );
    const violations = checkInPortUnknown(file);
    assert.equal(violations.length, 1);
    const v = violations[0];
    assert.ok(v, "expected exactly one violation");
    assert.equal(v.rule, "in-port-unknown");
    // Same key shape as the direct form: the alias is transparent to the key.
    assert.equal(v.specifier, "MyInPort.run:req");
    assert.match(v.message, /MyInPort/);
    assert.match(v.message, /request\.port\.ts/);
  });

  it("flags an exported in-port interface with a call-signature member typed unknown", () => {
    // `export interface Port { (req: unknown): void }` has NO method —
    // `getMethods()` returns nothing, so only a call-signature walk can catch
    // this shape. Without that walk the rule reports no violation at all.
    const file = sourceFile(
      "/ctx/src/application/ports/in/handler.port.ts",
      `export interface HandlerPort { (req: unknown): void; }`,
    );
    const violations = checkInPortUnknown(file);
    assert.equal(violations.length, 1);
    const v = violations[0];
    assert.ok(v, "expected exactly one violation");
    assert.equal(v.rule, "in-port-unknown");
    // A call signature has no name of its own: `<InterfaceName>:<param>`.
    assert.equal(v.specifier, "HandlerPort:req");
    assert.match(v.message, /HandlerPort/);
    assert.match(v.message, /\breq\b/);
    assert.match(v.message, /handler\.port\.ts/);

    // The mirror-image clean case emits nothing (no false positives).
    const clean = sourceFile(
      "/ctx/src/application/ports/in/clean-handler.port.ts",
      `export interface CleanHandlerPort { (req: { id: string }): void; }`,
    );
    assert.deepEqual(checkInPortUnknown(clean), []);
  });

  it("flags an exported in-port type alias with a parameter typed unknown", () => {
    // Function-type alias — a bare call signature.
    const fnAlias = sourceFile(
      "/ctx/src/application/ports/in/handler.in-port.ts",
      `export type MyInPort = (req: unknown) => Promise<void>;`,
    );
    const fnViolations = checkInPortUnknown(fnAlias);
    assert.equal(fnViolations.length, 1);
    const fn = fnViolations[0];
    assert.ok(fn, "expected exactly one violation");
    assert.equal(fn.rule, "in-port-unknown");
    // A call signature has no name of its own: `<alias>:<param>`.
    assert.equal(fn.specifier, "MyInPort:req");
    assert.match(fn.message, /MyInPort/);
    assert.match(fn.message, /handler\.in-port\.ts/);

    // Object-literal alias with a method signature — named signature form.
    const objectAlias = sourceFile(
      "/ctx/src/application/ports/in/runner.in-port.ts",
      `export type Runner = { run(req: unknown): Promise<void>; };`,
    );
    const objectViolations = checkInPortUnknown(objectAlias);
    assert.equal(objectViolations.length, 1);
    const obj = objectViolations[0];
    assert.ok(obj, "expected exactly one violation");
    assert.equal(obj.rule, "in-port-unknown");
    assert.equal(obj.specifier, "Runner.run:req");
    assert.match(obj.message, /Runner/);
    assert.match(obj.message, /\brun\b/);
    assert.match(obj.message, /\breq\b/);
  });
});

describe("checkInPortUnknown — no false positives", () => {
  it("allows an exported in-port interface whose parameters use typed or Validated request types", () => {
    const file = sourceFile(
      "/ctx/src/application/ports/in/clean.port.ts",
      `type Validated<T> = { readonly __brand: "Validated"; readonly value: T };
interface Env { workspaceRoot: string; }
export interface CleanPort {
  typed(req: { id: string }): Promise<void>;
  validated(req: Validated<{ id: string }>): Promise<void>;
  contextual(ctx: Env): Promise<void>;
  unioned(req: string | number | { id: string }): Promise<void>;
  intersected(req: { id: string } & { traceId: string }): Promise<void>;
}
export type TypedAlias = (req: { id: string }) => Promise<void>;`,
    );
    assert.deepEqual(checkInPortUnknown(file), []);
  });
});

describe("checkInPortUnknown — hostile AST / checker traps", () => {
  it("terminates without throwing on cyclic type aliases in an in-port", () => {
    const file = sourceFile(
      "/ctx/src/application/ports/in/cyclic.port.ts",
      `export type CycleA = CycleB;
export type CycleB = CycleA;
export interface CyclePort { run(req: CycleA): Promise<void>; }`,
    );
    // The contract is: terminates (this assertion runs at all) and reports no
    // violation (a cycle through unknown-free aliases is not unknown).
    assert.deepEqual(checkInPortUnknown(file), []);
  });

  it("handles untyped parameters and missing type nodes without throwing", () => {
    const file = sourceFile(
      "/ctx/src/application/ports/in/loose.port.ts",
      `export interface LoosePort {
  run(req): Promise<void>;
  noParams(): Promise<void>;
  loose(req: any): Promise<void>;
}`,
    );
    // `any` is NOT `unknown`; an implicit-any parameter has no type node to
    // spell `unknown`. Neither shape may throw, and neither is a violation.
    assert.deepEqual(checkInPortUnknown(file), []);
  });
});
