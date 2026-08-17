import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { MonacoSession } from "../../src/domain/monaco-session.js";
import type { MonacoPersistencePort } from "../../src/application/ports/monaco-persistence.port.js";

/**
 * `MonacoSession` is the shared kernel's editor-session entity — the value
 * `MonacoPersistencePort` is declared in terms of, and therefore the shape
 * every adapter in `web-driver` and `monaco-orchestration` is held to. The
 * entity's whole reason to exist beyond a bag of fields is the split between
 * persisted state and runtime-only state, so that split is what is asserted.
 *
 * The subject is the real class throughout; nothing is substituted.
 */

// Binds the entity to the PORT rather than to itself: the type below is
// whatever `saveSession` accepts, so if the port ever stops speaking
// `MonacoSession` this suite fails to compile before any assertion runs.
type PersistedSession = Parameters<MonacoPersistencePort["saveSession"]>[0];

describe("MonacoSession.createEmpty", () => {
  it("starts with empty content and the requested language", () => {
    const session = MonacoSession.createEmpty("session-1", "typescript");

    assert.equal(session.id, "session-1");
    assert.equal(session.content, "");
    assert.equal(session.language, "typescript");
  });

  it("defaults an unspecified language to plaintext", () => {
    assert.equal(MonacoSession.createEmpty("session-1").language, "plaintext");
  });

  it("starts clean and unattached — dirty and activeUri are runtime-only", () => {
    const session = MonacoSession.createEmpty("session-1");

    assert.equal(session.dirty, false);
    assert.equal(session.activeUri, undefined);
  });
});

describe("MonacoSession.toPersistedState", () => {
  it("drops the runtime-only fields (activeUri, dirty) from the snapshot", () => {
    const session = new MonacoSession(
      "session-1",
      "const a = 1;",
      "typescript",
      1_700_000_000_000,
      [],
      { cursor: 7 },
      "file:///a.ts",
      true,
    );

    const persisted = session.toPersistedState();

    assert.equal(persisted.activeUri, undefined);
    assert.equal(persisted.dirty, false);
  });

  it("carries every persisted field through unchanged", () => {
    const session = new MonacoSession(
      "session-1",
      "const a = 1;",
      "typescript",
      1_700_000_000_000,
      ["edit-1"],
      { cursor: 7 },
      "file:///a.ts",
      true,
    );

    const persisted = session.toPersistedState();

    assert.equal(persisted.id, "session-1");
    assert.equal(persisted.content, "const a = 1;");
    assert.equal(persisted.language, "typescript");
    assert.equal(persisted.lastModifiedAt, 1_700_000_000_000);
    assert.deepEqual(persisted.undoStack, ["edit-1"]);
    assert.deepEqual(persisted.metadata, { cursor: 7 });
  });

  it("leaves the source session's runtime state untouched", () => {
    const session = new MonacoSession(
      "session-1",
      "x",
      "typescript",
      1,
      [],
      {},
      "file:///a.ts",
      true,
    );

    session.toPersistedState();

    assert.equal(session.dirty, true);
    assert.equal(session.activeUri, "file:///a.ts");
  });
});

describe("MonacoSession.applyPersistedState", () => {
  it("adopts the persisted fields of a loaded snapshot", () => {
    const live = MonacoSession.createEmpty("session-1");
    const loaded: PersistedSession = new MonacoSession(
      "session-from-storage",
      "restored",
      "python",
      42,
      ["edit-1"],
      { cursor: 3 },
    );

    live.applyPersistedState(loaded);

    assert.equal(live.content, "restored");
    assert.equal(live.language, "python");
    assert.equal(live.lastModifiedAt, 42);
    assert.deepEqual(live.undoStack, ["edit-1"]);
    assert.deepEqual(live.metadata, { cursor: 3 });
  });

  it("keeps its own identity and runtime state — a restore is not a replace", () => {
    const live = new MonacoSession(
      "session-1",
      "draft",
      "typescript",
      1,
      [],
      {},
      "file:///live.ts",
      true,
    );
    const loaded = new MonacoSession(
      "session-from-storage",
      "restored",
      "python",
      42,
    );

    live.applyPersistedState(loaded);

    assert.equal(live.id, "session-1");
    assert.equal(live.activeUri, "file:///live.ts");
    assert.equal(live.dirty, true);
  });
});
