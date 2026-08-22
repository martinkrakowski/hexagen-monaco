import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { EmptyState } from "../EmptyState";

// Assertions use toBeTruthy()/getAttribute()/toBeNull() rather than jest-dom
// matchers: @testing-library/jest-dom is a dependency but apps/web's
// vitest.setup.ts never imports it, so toBeInTheDocument/toHaveAttribute are
// UNREGISTERED and would throw "is not a function" at call time.
describe("EmptyState", () => {
  it("renders the title as a real heading, not a styled div", () => {
    // The whole point of the title prop: a screen-reader user navigating by
    // heading has to be able to land on the empty region.
    render(<EmptyState title="No packages found" />);
    expect(
      screen.getByRole("heading", { name: "No packages found" }),
    ).toBeTruthy();
  });

  it("defaults the heading to level 3", () => {
    render(<EmptyState title="No packages found" />);
    expect(
      screen.getByRole("heading", { level: 3, name: "No packages found" }),
    ).toBeTruthy();
  });

  it("lets the host pick the heading level to match its own outline", () => {
    render(<EmptyState title="No findings" headingLevel={2} />);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.tagName).toBe("H2");
  });

  it("renders the description when one is supplied", () => {
    render(
      <EmptyState
        title="No scans yet"
        description="Import a repository to run your first scan."
      />,
    );
    expect(
      screen.getByText("Import a repository to run your first scan."),
    ).toBeTruthy();
  });

  it("renders no description paragraph when none is supplied", () => {
    const { container } = render(<EmptyState title="No scans yet" />);
    expect(container.querySelector("p")).toBeNull();
  });

  it("renders the icon and hides it from assistive tech", () => {
    // The glyph repeats what the title already says; announcing it would read
    // the empty state twice.
    const { container } = render(
      <EmptyState title="No scans yet" icon={Inbox} />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders no icon element when none is supplied", () => {
    const { container } = render(<EmptyState title="No scans yet" />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders the action slot", () => {
    render(
      <EmptyState
        title="No scans yet"
        action={<button type="button">Run a scan</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Run a scan" })).toBeTruthy();
  });

  it("appends the host's layout classes to the container", () => {
    const { container } = render(
      <EmptyState title="No scans yet" className="border-dashed" />,
    );
    const root = container.firstElementChild;
    expect(root?.getAttribute("class")).toContain("border-dashed");
    // The component's own layout must survive the merge, not be replaced.
    expect(root?.getAttribute("class")).toContain("flex");
  });

  it("renders a description of 0 rather than swallowing it", () => {
    // `description` is a ReactNode and 0 is a valid one. A bare truthiness
    // gate treated it as absent, so a caller passing a count of zero -- the
    // single most likely number to show in an empty state -- got nothing.
    const { container } = render(
      <EmptyState title="No findings" description={0} />,
    );
    expect(container.textContent).toContain("0");
  });

  it("does not wrap the description in a <p>", () => {
    // ReactNode permits flow content. A <ul> inside <p> is invalid HTML and
    // the browser closes the paragraph early, reparenting the node.
    const { container } = render(
      <EmptyState
        title="No findings"
        description={
          <ul>
            <li>first</li>
          </ul>
        }
      />,
    );
    expect(container.querySelector("p ul")).toBeNull();
    expect(container.querySelector("ul")).toBeTruthy();
  });

  it("lets a host override a base utility", () => {
    // With a plain string join both p-8 and p-0 survive and source order
    // decides. cn() resolves the conflict in the caller's favour.
    const { container } = render(
      <EmptyState title="No findings" className="p-0" />,
    );
    const root = container.firstElementChild;
    const cls = root?.getAttribute("class") ?? "";
    expect(cls).toContain("p-0");
    expect(cls).not.toContain("p-8");
  });
});
