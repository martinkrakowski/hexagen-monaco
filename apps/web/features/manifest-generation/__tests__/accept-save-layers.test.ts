import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { deriveInitialLayers, sessionMatchesSpec } from "../accept-save-layers";
import type { PendingSessionProvenance } from "../store/usePendingManifest";

const session: PendingSessionProvenance = {
  specText: "name: distilled-app\ncontexts: []",
  turns: [
    { id: "t1", author: "You", content: "the brief", role: "human" },
    { id: "t2", author: "Proposer", content: "p1", role: "proposer", round: 1 },
    { id: "t3", author: "Critic", content: "ok", role: "critic", round: 1 },
  ],
  sourceProjectId: "src-project",
  sourceLayerId: "src-layer",
};

describe("sessionMatchesSpec", () => {
  it("matches only when the imported spec is exactly the confirmed session spec (trim-insensitive)", () => {
    assert.equal(sessionMatchesSpec(session, session.specText), true);
    assert.equal(sessionMatchesSpec(session, `  ${session.specText}\n`), true);
    assert.equal(sessionMatchesSpec(session, "name: something-else"), false);
    assert.equal(sessionMatchesSpec(session, null), false);
    assert.equal(sessionMatchesSpec(null, session.specText), false);
  });
});

describe("deriveInitialLayers", () => {
  it("attaches the FULL session transcript as a completed, linked layer when the spec matches", () => {
    const layers = deriveInitialLayers(session.specText, session, 777);
    assert.equal(layers.length, 1);
    const layer = layers[0];
    assert.equal(layer.kind, "brainstorm");
    assert.equal(layer.title, "Live planning session");
    assert.equal(layer.status, "done");
    assert.deepEqual(layer.link, { type: "produced-manifest", at: 777 });
    assert.equal(layer.turns.length, 3);
    assert.equal(layer.turns[0].content, "the brief");
    // Defensive copy: mutating the derived turns must not touch the store's.
    assert.notEqual(layer.turns[0], session.turns[0]);
    assert.deepEqual(layer.turns[2], session.turns[2]);
  });

  it("falls back to a single imported-spec turn when the session does NOT match (abandoned finalize can't leak)", () => {
    const layers = deriveInitialLayers("name: unrelated-import", session, 777);
    assert.equal(layers.length, 1);
    const layer = layers[0];
    assert.equal(layer.title, "Imported project spec");
    assert.equal(layer.status, undefined, "not marked done");
    // The guard blocks the session TRANSCRIPT and done-status from leaking —
    // not the provenance link: the pasted spec is still literally what the
    // accepted manifest was generated from (Phase-2 semantics, pinned by
    // ManifestAcceptPage's "stamps the produced-manifest link" test).
    assert.deepEqual(layer.link, { type: "produced-manifest", at: 777 });
    assert.equal(layer.turns.length, 1);
    assert.equal(layer.turns[0].content, "name: unrelated-import");
    assert.equal(layer.turns[0].author, "Imported");
  });

  it("returns no layers for a blank or absent imported spec (prompt-flow projects)", () => {
    assert.deepEqual(deriveInitialLayers(null, null), []);
    assert.deepEqual(deriveInitialLayers("   \n", null), []);
    assert.deepEqual(deriveInitialLayers(null, session), []);
  });
});
