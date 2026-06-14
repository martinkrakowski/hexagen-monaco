import { JSDOM } from "jsdom";

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "http://localhost/",
});
global.window = dom.window as unknown as Window & typeof globalThis;
global.document = dom.window.document as unknown as Document;
// jsdom doesn't implement the native <dialog> modal API the @hexagen/ui Dialog
// calls (dialog.showModal()) — stub it so the panel mounts.
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
dom.window.HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};

import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert";
import React from "react";
import { render, cleanup } from "@testing-library/react";
import {
  FreeTierModelModalView,
  type FreeTierModelModalViewProps,
} from "../FreeTierModelModal";

// The pure view takes everything as props, so no hook/router mocking is needed
// (neither next/navigation nor the local hook modules can be redefined under
// the test runner — `mock.method` throws "Cannot redefine property"). Buttons
// are queried by text from the raw DOM rather than getByRole, because jsdom's
// <dialog> a11y is incomplete — its subtree isn't exposed to role queries.
function setup(overrides: Partial<FreeTierModelModalViewProps> = {}) {
  const props: FreeTierModelModalViewProps = {
    open: true,
    modelName: "mercury-2",
    hasLocalModel: false,
    webLLMReady: false,
    onClose: mock.fn(),
    onUseWebLLM: mock.fn(),
    onUseFreeTier: mock.fn(),
    onOpenModels: mock.fn(),
    ...overrides,
  };
  render(<FreeTierModelModalView {...props} />);
  return props;
}

const bodyText = () => (document.body.textContent || "").replace(/\s+/g, " ");

function clickButton(label: RegExp) {
  const btn = Array.from(document.querySelectorAll("button")).find((b) =>
    label.test(b.textContent || ""),
  );
  assert.ok(btn, `expected a button matching ${label}`);
  btn.click();
}

const calls = (
  fn: FreeTierModelModalViewProps[keyof FreeTierModelModalViewProps],
) => (fn as ReturnType<typeof mock.fn>).mock.calls.length;

describe("FreeTierModelModalView", () => {
  beforeEach(() => cleanup());

  it("names the real generation model in the lead copy", () => {
    setup({ modelName: "mercury-2" });
    assert.match(bodyText(), /Free Tier/);
    assert.match(bodyText(), /mercury-2/);
  });

  it("states the fair-use cap and drops the stale slowness copy", () => {
    setup();
    const text = bodyText();
    assert.match(text, /10 requests per minute/);
    // The regression this PR fixes: pre-mercury-flip slowness copy must be gone.
    assert.doesNotMatch(text, /40 tokens/i);
    assert.doesNotMatch(text, /tokens per second/i);
    assert.doesNotMatch(text, /5.?10 minutes/i);
  });

  it("offers WebLLM (local) and BYOK (frontier) as alternatives", () => {
    setup();
    const text = bodyText();
    assert.match(text, /Use WebLLM \(Local\)/);
    assert.match(text, /Private · Offline/);
    assert.match(text, /Bring Your Own Keys/);
    assert.match(text, /Frontier models/);
  });

  it("falls back to a generic phrase when the model name is unknown", () => {
    setup({ modelName: null });
    assert.match(bodyText(), /our hosted model/);
  });

  it("no local model: 'Choose a local model' → onUseWebLLM, 'Continue on Free Tier' → onClose", () => {
    const props = setup({ hasLocalModel: false });
    clickButton(/choose a local model/i);
    assert.strictEqual(calls(props.onUseWebLLM), 1);
    clickButton(/continue on free tier/i);
    assert.strictEqual(calls(props.onClose), 1);
  });

  it("local model loaded: 'Switch to WebLLM' → onUseWebLLM, 'Use Free Tier instead' → onUseFreeTier", () => {
    const props = setup({ hasLocalModel: true, webLLMReady: true });
    clickButton(/switch to webllm/i);
    assert.strictEqual(calls(props.onUseWebLLM), 1);
    clickButton(/use free tier instead/i);
    assert.strictEqual(calls(props.onUseFreeTier), 1);
  });

  it("the BYOK card → onOpenModels", () => {
    const props = setup();
    clickButton(/bring your own keys/i);
    assert.strictEqual(calls(props.onOpenModels), 1);
  });
});
