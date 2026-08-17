import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import { cleanup, render } from "@testing-library/react";
import { LOCAL_MODELS, DomainModelId } from "@hexagen/local-llm/client";
import {
  ModelTierSection,
  type ModelTierSectionProps,
} from "../src/ui/model-settings/model-tier-section.js";

/**
 * `ModelTierSection` takes SECTION-wide props and decides, per card, which of
 * them apply to that card: the compatibility warning belongs to the selected
 * model, the progress bar to the downloading model, the recommended badge to
 * the recommended model, and each card's callbacks must close over its OWN id.
 * None of that is expressible in the prop types, and all of it is the kind of
 * routing a loop gets wrong silently.
 *
 * The real `ModelCard` renders underneath — the children are not substituted,
 * so what is asserted is the DOM a user would actually get.
 *
 * Descriptors come from the real `LOCAL_MODELS` catalog rather than invented
 * literals, so the suite fails if the catalog stops satisfying the structural
 * shape this section renders.
 */

const TIER = LOCAL_MODELS.filter((model) => model.tier === "desktop-high");
const [FIRST, SECOND] = TIER;

afterEach(() => {
  cleanup();
});

function baseProps(): ModelTierSectionProps {
  return {
    title: "Desktop",
    descriptors: TIER,
    currentModelId: null,
    selectedModelId: null,
    confirmDeleteId: null,
    pendingSwitchId: null,
    recommendedModelId: null,
    cacheStatusMap: new Map(),
    onSelectModel: () => {},
    onDelete: () => {},
    onConfirmDelete: () => {},
    onCancelDelete: () => {},
    onConfirmSwitch: () => {},
    onCancelSwitch: () => {},
    currentModelDisplayName: null,
    isLoading: false,
    isSwitching: false,
    isDeleting: false,
    error: null,
    loadedModel: null,
  };
}

describe("ModelTierSection — empty tier", () => {
  it("renders nothing at all, not an empty heading", () => {
    const { container } = render(
      <ModelTierSection {...baseProps()} descriptors={[]} />,
    );

    assert.equal(container.innerHTML, "");
  });

  it("renders its heading and a card per descriptor otherwise", () => {
    const { getByText, getAllByRole } = render(
      <ModelTierSection {...baseProps()} />,
    );

    assert.ok(getByText("Desktop"));
    assert.equal(getAllByRole("button").length, TIER.length);
  });
});

describe("ModelTierSection — per-card routing of section-wide props", () => {
  it("shows the compatibility warning ONLY on the selected model's card", () => {
    const { getByText, queryByText } = render(
      <ModelTierSection
        {...baseProps()}
        selectedModelId={SECOND.modelId}
        compatibilityIssue={{ reason: "Not enough VRAM", severity: "error" }}
      />,
    );

    const warnings = queryByText(/Not enough VRAM/);
    assert.ok(warnings, "the selected card should carry the warning");
    // The card the warning belongs to is the one whose name is rendered beside
    // it, so walk up to the card and check it is the SECOND model, not the first.
    const card = warnings.closest("div.rounded-xl");
    assert.ok(card?.textContent?.includes(SECOND.displayName));
    assert.equal(card?.textContent?.includes(FIRST.displayName), false);
    assert.ok(getByText(FIRST.displayName));
  });

  it("shows no warning anywhere when nothing is selected", () => {
    const { queryByText } = render(
      <ModelTierSection
        {...baseProps()}
        selectedModelId={null}
        compatibilityIssue={{ reason: "Not enough VRAM", severity: "error" }}
      />,
    );

    assert.equal(queryByText(/Not enough VRAM/), null);
  });

  it("shows download progress ONLY on the downloading model's card", () => {
    const { getByText, getAllByRole } = render(
      <ModelTierSection
        {...baseProps()}
        downloadingModelId={FIRST.modelId}
        downloadProgress={0.42}
      />,
    );

    assert.ok(getByText(/42%/));
    const buttons = getAllByRole("button");
    // Only the downloading card's action reads "Downloading…"; the sibling
    // cards keep their own action label.
    const downloading = buttons.filter((button) =>
      button.textContent?.includes("Downloading"),
    );
    assert.equal(downloading.length, 1);
  });

  it("does not put a progress bar on the other cards in the tier", () => {
    const { container } = render(
      <ModelTierSection
        {...baseProps()}
        downloadingModelId={FIRST.modelId}
        downloadProgress={0.42}
      />,
    );

    // Every progress readout renders as "<n>% · <eta>". Exactly one card in
    // the tier may have one — a sibling showing "0% · Estimating…" means the
    // downloading flag was routed to the whole tier instead of one card.
    const readouts = container.textContent?.match(/\d+% ·/g) ?? [];
    assert.deepEqual(readouts, ["42% ·"]);
  });

  it("badges only the recommended model", () => {
    const { getAllByText } = render(
      <ModelTierSection {...baseProps()} recommendedModelId={SECOND.modelId} />,
    );

    const badges = getAllByText(/Recommended/);
    assert.equal(badges.length, 1);
    assert.ok(
      badges[0]
        .closest("div.rounded-xl")
        ?.textContent?.includes(SECOND.displayName),
    );
  });
});

describe("ModelTierSection — card status precedence", () => {
  it("prefers the delete confirmation when a model is both pending switch and pending delete", () => {
    const { getByText, queryByText } = render(
      <ModelTierSection
        {...baseProps()}
        confirmDeleteId={FIRST.modelId}
        pendingSwitchId={FIRST.modelId}
      />,
    );

    assert.ok(getByText(`Delete ${FIRST.displayName}?`));
    assert.equal(queryByText("Switch models?"), null);
  });

  it("puts a different model into the switch confirmation independently", () => {
    const { getByText } = render(
      <ModelTierSection
        {...baseProps()}
        confirmDeleteId={FIRST.modelId}
        pendingSwitchId={SECOND.modelId}
      />,
    );

    assert.ok(getByText(`Delete ${FIRST.displayName}?`));
    assert.ok(getByText("Switch models?"));
  });
});

describe("ModelTierSection — intents carry the card's own id", () => {
  it("raises onSelectModel with the id of the card that was clicked", () => {
    const selected: DomainModelId[] = [];
    const { getAllByRole } = render(
      <ModelTierSection
        {...baseProps()}
        onSelectModel={(modelId) => selected.push(modelId)}
      />,
    );

    const buttons = getAllByRole("button");
    buttons[1].click();

    assert.deepEqual(selected, [SECOND.modelId]);
  });

  it("offers Delete only for a cached model that is not the active one", () => {
    const { getAllByRole } = render(
      <ModelTierSection
        {...baseProps()}
        currentModelId={FIRST.modelId}
        cacheStatusMap={
          new Map([
            [FIRST.modelId, { isCached: true, isChecking: false }],
            [SECOND.modelId, { isCached: true, isChecking: false }],
          ])
        }
      />,
    );

    const deletes = getAllByRole("button").filter(
      (button) => button.textContent === "Delete",
    );
    assert.equal(deletes.length, 1);
  });

  it("raises onDelete with the id of the card whose Delete was clicked", () => {
    const deleted: DomainModelId[] = [];
    const { getAllByRole } = render(
      <ModelTierSection
        {...baseProps()}
        onDelete={(modelId) => deleted.push(modelId)}
        cacheStatusMap={
          new Map([[SECOND.modelId, { isCached: true, isChecking: false }]])
        }
      />,
    );

    const deleteButton = getAllByRole("button").find(
      (button) => button.textContent === "Delete",
    );
    assert.ok(deleteButton);
    deleteButton.click();

    assert.deepEqual(deleted, [SECOND.modelId]);
  });
});
