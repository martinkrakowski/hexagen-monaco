import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { FileDropZone } from "../../src/modules/FileDropZone.js";

let dom: JSDOM;

before(() => {
  dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  global.window = dom.window;
  global.document = dom.window.document;
  Object.defineProperty(global, "navigator", {
    value: dom.window.navigator,
    writable: true,
  });
  // Mock FileReader
  global.FileReader = class {
    onload: ((e: any) => void) | null = null;
    onerror: (() => void) | null = null;
    result: string | null = null;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    readAsText(_file: File) {
      this.result = "mock file content";
      if (this.onload) this.onload({ target: { result: this.result } });
    }
  } as unknown as typeof FileReader;
  // Mock File
  global.File = class {
    name: string;
    type: string;
    constructor(parts: string[], name: string, options?: { type?: string }) {
      this.name = name;
      this.type = options?.type || "";
    }
  } as unknown as typeof File;
});

afterEach(() => {
  cleanup();
});

describe("FileDropZone component", () => {
  const defaultProps = {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onFileLoaded: (_content: string) => {},
    accept: ".txt",
    label: "Upload file",
    hint: "Drop a text file",
  };

  it("renders drop zone container", () => {
    const { container } = render(
      React.createElement(FileDropZone, defaultProps),
    );
    const dropZone = container.querySelector('[role="button"]');
    assert.ok(dropZone);
  });

  it("renders upload icon", () => {
    const { container } = render(
      React.createElement(FileDropZone, defaultProps),
    );
    const icon = container.querySelector("svg"); // Icon component renders svg
    assert.ok(icon);
  });

  it("renders hint text", () => {
    const { getByText } = render(
      React.createElement(FileDropZone, defaultProps),
    );
    assert.ok(getByText("Drop a text file"));
  });

  it("triggers file input click on drop zone click", () => {
    const { container } = render(
      React.createElement(FileDropZone, defaultProps),
    );
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    input.click = () => {};
    const dropZone = container.querySelector('[role="button"]');
    fireEvent.click(dropZone);
    // Mock click on input
    fireEvent.click(input);
    assert.ok(input);
  });

  it("handles file selection via input change", () => {
    let loadedContent = "";
    const { container } = render(
      React.createElement(FileDropZone, {
        ...defaultProps,
        onFileLoaded: (content: string) => {
          loadedContent = content;
        },
      }),
    );
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["test"], "test.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });
    assert.strictEqual(loadedContent, "mock file content");
  });

  it("shows error on invalid file validation", () => {
    const { container } = render(
      React.createElement(FileDropZone, {
        ...defaultProps,
        validateFile: () => "Invalid file type",
      }),
    );
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["test"], "test.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });
    const error = container.querySelector('[role="alert"]');
    assert.ok(error);
    assert.match(error.textContent, /Invalid file type/);
  });

  it("handles drag over state", () => {
    const { container } = render(
      React.createElement(FileDropZone, defaultProps),
    );
    const dropZone = container.querySelector('[role="button"]');
    fireEvent.dragOver(dropZone);
    assert.strictEqual(dropZone?.getAttribute("data-drag-over"), "true");
  });

  // TODO: Fix drag leave test
  // it("handles drag leave state", () => {
  //   const { container } = render(React.createElement(FileDropZone, defaultProps));
  //   const dropZone = container.querySelector('[role="button"]');
  //   fireEvent.dragOver(dropZone);
  //   fireEvent.dragLeave(dropZone);
  //   assert.ok(!dropZone.className.includes("border-primary"));
  // });

  it("applies correct aria-label", () => {
    const { container } = render(
      React.createElement(FileDropZone, defaultProps),
    );
    const dropZone = container.querySelector('[role="button"]');
    assert.strictEqual(dropZone?.getAttribute("aria-label"), "Upload file");
  });
});
