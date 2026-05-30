import { JSDOM } from "jsdom";

// Mark the run as a test environment before any app module is imported (only
// jsdom is imported above, and it doesn't read NODE_ENV). The structured logger
// keys off this to stay silent in tests — otherwise harmless, expected failures
// (e.g. the boot data migration, which can't run against the Node test runner's
// localStorage) spam the CI log.
(process.env as Record<string, string | undefined>).NODE_ENV ??= "test";

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "http://localhost",
  pretendToBeVisual: true,
});

const { window } = dom;

globalThis.document = window.document;
globalThis.window = window as unknown as Window & typeof globalThis;

Object.defineProperty(globalThis, "navigator", {
  value: window.navigator,
  writable: false,
  configurable: true,
});

globalThis.self = window as unknown as Window & typeof globalThis;
globalThis.HTMLElement = window.HTMLElement;
globalThis.HTMLCanvasElement = window.HTMLCanvasElement;
globalThis.SVGElement = window.SVGElement;
globalThis.CustomEvent = window.CustomEvent;
globalThis.Event = window.Event;
globalThis.KeyboardEvent = window.KeyboardEvent;
globalThis.MouseEvent = window.MouseEvent;
globalThis.Node = window.Node;
globalThis.DocumentFragment = window.DocumentFragment;
globalThis.Element = window.Element;
