// JSDOM globals must exist before @testing-library/react is imported.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "http://localhost/",
});
global.window = dom.window as unknown as Window & typeof globalThis;
global.document = dom.window.document as unknown as Document;
global.localStorage = dom.window.localStorage;

import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
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

  it("rebuilds wizardData on id-set change, not on answer-only change (canvasHash granularity)", () => {
    const { result } = renderHook(() => useWizardForm());
    act(() => {
      result.current.form.setValue("addOnsAnswers", {
        bullmq: { queueName: "a" },
      });
    });
    const afterSelect = result.current.wizardData;

    // Same id-set, different answer value → stable reference (no canvas redraw).
    act(() => {
      result.current.form.setValue("addOnsAnswers", {
        bullmq: { queueName: "b" },
      });
    });
    assert.equal(
      result.current.wizardData,
      afterSelect,
      "answer-only change must NOT rebuild wizardData",
    );

    // New id added → rebuild (new reference).
    act(() => {
      result.current.form.setValue("addOnsAnswers", {
        bullmq: { queueName: "b" },
        supabase: {},
      });
    });
    assert.notEqual(
      result.current.wizardData,
      afterSelect,
      "id-set change MUST rebuild wizardData",
    );
  });
});
