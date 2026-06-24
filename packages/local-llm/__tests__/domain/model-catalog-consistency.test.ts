/**
 * Catalog consistency pins: every model the UI offers must be loadable
 * (MLC id present) and describable (metadata present), legacy migrations
 * must point at live models, and the reasoning-model policy must hold
 * (baseline finding F1: reasoning-default models are only allowed when
 * thinking can be disabled — flagged via ModelMetadata.reasoningDefault;
 * DeepSeek-R1-Distill-class models, whose thinking cannot be disabled,
 * must never appear).
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { LOCAL_MODELS } from "../../src/domain/model-catalog.js";
import {
  DomainModelId,
  LEGACY_MODEL_MIGRATION,
  isDomainModelId,
} from "../../src/domain/value-objects/model-id.vo.js";
import { MODEL_METADATA_MAP } from "../../src/domain/value-objects/model-metadata.vo.js";
import { MLC_IDS } from "../../src/infrastructure/adapters/webllm-constants.js";

describe("model catalog consistency", () => {
  it("every catalog model has an MLC id and metadata", () => {
    for (const m of LOCAL_MODELS) {
      assert.ok(MLC_IDS[m.modelId], `${m.modelId} missing in MLC_IDS`);
      assert.ok(
        MODEL_METADATA_MAP[m.modelId],
        `${m.modelId} missing in MODEL_METADATA_MAP`,
      );
    }
  });

  it("every DomainModelId appears in the catalog exactly once", () => {
    const catalogIds = LOCAL_MODELS.map((m) => m.modelId);
    assert.deepEqual(
      [...catalogIds].sort(),
      Object.values(DomainModelId).sort(),
    );
    assert.equal(new Set(catalogIds).size, catalogIds.length);
  });

  it("legacy migrations target live models (dropped ids stay migratable)", () => {
    for (const [legacy, target] of Object.entries(LEGACY_MODEL_MIGRATION)) {
      assert.ok(
        isDomainModelId(target),
        `migration ${legacy} → ${target} targets an unknown model`,
      );
      assert.notEqual(
        legacy,
        target,
        `migration ${legacy} must not be self-referential`,
      );
    }
    // The Qwen3 refresh dropped these — persisted ids must keep resolving.
    assert.equal(LEGACY_MODEL_MIGRATION["phi-3-mini"], DomainModelId.QWEN3_4B);
    assert.equal(
      LEGACY_MODEL_MIGRATION["phi-3.5-mini"],
      DomainModelId.QWEN3_4B,
    );
    assert.equal(
      LEGACY_MODEL_MIGRATION["gemma-2-2b"],
      DomainModelId.QWEN3_1_7B,
    );
  });

  it("Qwen3 family is flagged reasoningDefault; nothing undisableable ships", () => {
    for (const m of LOCAL_MODELS) {
      const meta = MODEL_METADATA_MAP[m.modelId];
      if (m.modelId.startsWith("qwen3-")) {
        assert.equal(
          meta.reasoningDefault,
          true,
          `${m.modelId} must be flagged reasoningDefault`,
        );
      }
      // F1 exclusion: models whose thinking cannot be turned off must not
      // be in the catalog at all (enforced by review; this pins the known
      // family so a future addition trips a deliberate test change).
      assert.ok(
        !/deepseek|r1-distill/i.test(m.modelId),
        `${m.modelId} is an always-thinking model — excluded per F1`,
      );
    }
  });
});
