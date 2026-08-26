import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { Avatar } from "../../src/elements/Avatar.js";

afterEach(() => {
  cleanup();
});

describe("Avatar component", () => {
  it("renders the image with alt = name when src is given", () => {
    const { getByAltText } = render(
      React.createElement(Avatar, {
        name: "Ada Lovelace",
        src: "https://example.test/ada.png",
      }),
    );
    const img = getByAltText("Ada Lovelace");
    assert.ok(img instanceof HTMLImageElement);
    assert.equal(img.getAttribute("src"), "https://example.test/ada.png");
  });

  it("falls back to up-to-2-letter initials when src is missing", () => {
    const { getByRole, container } = render(
      React.createElement(Avatar, { name: "Ada Lovelace" }),
    );
    const wrapper = getByRole("img", { name: "Ada Lovelace" });
    assert.equal(container.querySelector("img"), null);
    const initials = wrapper.querySelector("[aria-hidden='true']");
    assert.ok(initials);
    assert.equal(initials.textContent, "AL");
  });

  it("derives a single initial from a one-word name", () => {
    const { getByRole } = render(React.createElement(Avatar, { name: "Cher" }));
    const wrapper = getByRole("img", { name: "Cher" });
    assert.equal(
      wrapper.querySelector("[aria-hidden='true']")?.textContent,
      "C",
    );
  });

  it("falls back to initials when the image errors", () => {
    const { container, getByRole } = render(
      React.createElement(Avatar, {
        name: "Ada Lovelace",
        src: "https://example.test/broken.png",
      }),
    );
    const img = container.querySelector("img");
    assert.ok(img instanceof HTMLImageElement);
    fireEvent.error(img);
    assert.equal(container.querySelector("img"), null);
    const wrapper = getByRole("img", { name: "Ada Lovelace" });
    assert.equal(
      wrapper.querySelector("[aria-hidden='true']")?.textContent,
      "AL",
    );
  });

  it("hides the initials block from assistive tech, naming the wrapper", () => {
    const { getByRole } = render(
      React.createElement(Avatar, { name: "Grace Hopper" }),
    );
    const wrapper = getByRole("img", { name: "Grace Hopper" });
    assert.equal(wrapper.getAttribute("aria-label"), "Grace Hopper");
    const initials = wrapper.querySelector("span");
    assert.equal(initials?.getAttribute("aria-hidden"), "true");
  });

  it("applies size variants", () => {
    const { getByRole, unmount } = render(
      React.createElement(Avatar, { name: "Ada Lovelace", size: "sm" }),
    );
    assert.match(getByRole("img").className, /h-8/);
    unmount();
    const second = render(
      React.createElement(Avatar, { name: "Ada Lovelace" }),
    );
    assert.match(second.getByRole("img").className, /h-10/);
  });

  it("a NEW src after a failure gets a fresh attempt — failure is per source", () => {
    const { container, rerender } = render(
      React.createElement(Avatar, { name: "Ada Lovelace", src: "/broken.png" }),
    );
    const img = container.querySelector("img");
    assert.ok(img, "image mode must render first");
    fireEvent.error(img as HTMLImageElement);
    assert.equal(container.querySelector("img"), null, "fallback after error");

    rerender(
      React.createElement(Avatar, { name: "Ada Lovelace", src: "/fixed.png" }),
    );
    assert.ok(
      container.querySelector("img"),
      "a different src must not inherit the previous failure",
    );
  });
});
