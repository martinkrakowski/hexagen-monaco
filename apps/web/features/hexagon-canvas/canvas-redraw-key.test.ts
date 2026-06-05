import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { WizardData } from "@hexagen/project-configuration";
import { canvasRedrawKey } from "./canvas-redraw-key";

const wiz = (over: Partial<WizardData>): WizardData =>
  ({
    boundedContexts: [],
    externalContexts: [],
    peerMappings: [],
    addOnsAnswers: {},
    ...over,
  }) as WizardData;

describe("canvasRedrawKey", () => {
  it("is stable when only an add-on answer VALUE changes (no canvas redraw)", () => {
    assert.deepEqual(
      canvasRedrawKey(wiz({ addOnsAnswers: { bullmq: { queueName: "a" } } })),
      canvasRedrawKey(wiz({ addOnsAnswers: { bullmq: { queueName: "b" } } })),
    );
  });

  it("is stable when only governance changes (no canvas redraw)", () => {
    assert.deepEqual(
      canvasRedrawKey(
        wiz({ governance: { workspaceName: "x" } as WizardData["governance"] }),
      ),
      canvasRedrawKey(
        wiz({ governance: { workspaceName: "y" } as WizardData["governance"] }),
      ),
    );
  });

  it("changes when the selected add-on id-set changes", () => {
    assert.notDeepEqual(
      canvasRedrawKey(wiz({ addOnsAnswers: { bullmq: {} } })),
      canvasRedrawKey(wiz({ addOnsAnswers: { bullmq: {}, supabase: {} } })),
    );
  });

  it("changes when bounded contexts change", () => {
    assert.notDeepEqual(
      canvasRedrawKey(wiz({ boundedContexts: [] })),
      canvasRedrawKey(
        wiz({
          boundedContexts: [{ id: "c1" }] as WizardData["boundedContexts"],
        }),
      ),
    );
  });
});
