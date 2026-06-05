// JSDOM globals must exist before @testing-library/react is imported.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "http://localhost/",
});
global.window = dom.window as unknown as Window & typeof globalThis;
global.document = dom.window.document as unknown as Document;
global.localStorage = dom.window.localStorage;

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useWizardForm } from "../useWizardForm";

afterEach(() => cleanup());

describe("useWizardForm — addOnsAnswers → wizardData (canvas overlay source)", () => {
  it("defaults to empty addOnsAnswers (graceful: overlay shows nothing)", () => {
    const { result } = renderHook(() => useWizardForm());
    assert.deepEqual(result.current.wizardData.addOnsAnswers, {});
  });

  it("reflects a selection in wizardData.addOnsAnswers (non-empty after select)", () => {
    const { result } = renderHook(() => useWizardForm());
    act(() => {
      result.current.form.setValue("addOnsAnswers", {
        bullmq: {},
        supabase: {},
      });
    });
    assert.deepEqual(
      Object.keys(result.current.wizardData.addOnsAnswers).sort(),
      ["bullmq", "supabase"],
    );
  });

  it("keeps wizardData.addOnsAnswers fresh on an answer-value change (no staleness for generation/export)", () => {
    const { result } = renderHook(() => useWizardForm());
    act(() => {
      result.current.form.setValue("addOnsAnswers", {
        bullmq: { queueName: "a" },
      });
    });
    assert.deepEqual(result.current.wizardData.addOnsAnswers, {
      bullmq: { queueName: "a" },
    });

    // Same id-set, new answer value → wizardData MUST reflect it. The canvas-only
    // "don't redraw on answer-only changes" optimization lives in
    // useCanvasState/canvasRedrawKey, NOT in this shared provider — so the value
    // can never go stale for generation/export.
    act(() => {
      result.current.form.setValue("addOnsAnswers", {
        bullmq: { queueName: "b" },
      });
    });
    assert.deepEqual(result.current.wizardData.addOnsAnswers, {
      bullmq: { queueName: "b" },
    });
  });
});
