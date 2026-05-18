import { JSDOM } from "jsdom";

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
