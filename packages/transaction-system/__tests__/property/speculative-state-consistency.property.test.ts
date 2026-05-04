import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NodeKind } from "@hexagen/core-domain";
import type { DomainAST } from "@hexagen/core-domain";
import { InMemorySpeculativeStateMachine } from "../../src/infrastructure/adapters/in-memory-speculative-state-machine.adapter.js";

function makeAST(): DomainAST {
  return {
    nodes: [
      { id: "n1", kind: NodeKind.Aggregate, attributes: { label: "Test" } },
    ],
    edges: [],
    invariants: { topology: [], cardinality: [] },
  };
}

type Command =
  | { type: "apply" }
  | { type: "commit"; snapshotIndex: number }
  | { type: "rollback"; snapshotIndex: number }
  | { type: "getState"; snapshotIndex: number };

function randomCommand(): Command {
  const roll = Math.random();
  if (roll < 0.25) return { type: "apply" };
  if (roll < 0.5) return { type: "commit", snapshotIndex: 0 };
  if (roll < 0.75) return { type: "rollback", snapshotIndex: 0 };
  return { type: "getState", snapshotIndex: 0 };
}

function resolveIndex(
  snapshots: string[],
  snapshotIndex: number,
): string | null {
  if (snapshots.length === 0) return null;
  return snapshots[snapshotIndex % snapshots.length];
}

function runScenario(commands: Command[]): boolean {
  const machine = new InMemorySpeculativeStateMachine();
  const ast = makeAST();
  const snapshots: string[] = [];
  const committed: Set<string> = new Set();
  const rolledBack: Set<string> = new Set();

  for (const cmd of commands) {
    switch (cmd.type) {
      case "apply": {
        const id = machine.applySpeculative(ast, { op: "test" });
        snapshots.push(id);
        break;
      }
      case "commit": {
        const sid = resolveIndex(snapshots, cmd.snapshotIndex);
        if (sid === null) break;
        const result = machine.commitSpeculative(sid);
        if (committed.has(sid)) {
          if (result !== false) return false;
        } else if (rolledBack.has(sid)) {
          if (result !== false) return false;
        } else {
          committed.add(sid);
        }
        break;
      }
      case "rollback": {
        const sid = resolveIndex(snapshots, cmd.snapshotIndex);
        if (sid === null) break;
        const result = machine.rollbackSpeculative(sid);
        if (committed.has(sid)) {
          if (result !== false) return false;
        } else if (rolledBack.has(sid)) {
          if (result !== false) return false;
        } else {
          rolledBack.add(sid);
        }
        break;
      }
      case "getState": {
        const sid = resolveIndex(snapshots, cmd.snapshotIndex);
        if (sid === null) break;
        const state = machine.getSpeculativeState(sid);
        if (committed.has(sid)) {
          if (state === null) return false;
        }
        if (rolledBack.has(sid)) {
          if (state !== null) return false;
        }
        break;
      }
    }
  }

  for (const sid of committed) {
    if (machine.rollbackSpeculative(sid) !== false) return false;
  }

  for (const sid of committed) {
    if (machine.getSpeculativeState(sid) === null) return false;
  }

  for (const sid of rolledBack) {
    if (machine.getSpeculativeState(sid) !== null) return false;
  }

  return true;
}

function generateCommands(length: number): Command[] {
  const commands: Command[] = [];
  for (let i = 0; i < length; i++) {
    const cmd = randomCommand();
    if ("snapshotIndex" in cmd) {
      (cmd as Command & { snapshotIndex: number }).snapshotIndex = Math.floor(
        Math.random() * 20,
      );
    }
    commands.push(cmd);
  }
  return commands;
}

describe("Property: No rollback path produces inconsistent SpeculativeState", () => {
  const NUM_RUNS = 1000;

  it("should hold for 1000 random command sequences", () => {
    let violations = 0;

    for (let run = 0; run < NUM_RUNS; run++) {
      const commands = generateCommands(3 + Math.floor(Math.random() * 48));
      const ok = runScenario(commands);
      if (!ok) {
        violations++;
      }
    }

    assert.strictEqual(violations, 0);
  });

  it("committed snapshot should never be rollable", () => {
    for (let run = 0; run < NUM_RUNS; run++) {
      const machine = new InMemorySpeculativeStateMachine();
      const ast = makeAST();
      const sid = machine.applySpeculative(ast, { op: "commit-test" });
      machine.commitSpeculative(sid);
      assert.strictEqual(machine.rollbackSpeculative(sid), false);
    }
  });

  it("rolled-back snapshot should return null from getSpeculativeState", () => {
    for (let run = 0; run < NUM_RUNS; run++) {
      const machine = new InMemorySpeculativeStateMachine();
      const ast = makeAST();
      const sid = machine.applySpeculative(ast, { op: "rollback-test" });
      machine.rollbackSpeculative(sid);
      assert.strictEqual(machine.getSpeculativeState(sid), null);
    }
  });

  it("committed snapshot should still be accessible via getSpeculativeState", () => {
    for (let run = 0; run < NUM_RUNS; run++) {
      const machine = new InMemorySpeculativeStateMachine();
      const ast = makeAST();
      const sid = machine.applySpeculative(ast, { op: "access-test" });
      machine.commitSpeculative(sid);
      const state = machine.getSpeculativeState(sid);
      assert.ok(state !== null);
    }
  });
});
