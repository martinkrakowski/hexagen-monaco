import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { StoredHistoryNotice } from "./StoredHistoryNotice";

describe("StoredHistoryNotice", () => {
  it("renders the count and both buttons", () => {
    const onDownload = vi.fn();
    const onDiscard = vi.fn();

    render(
      <StoredHistoryNotice
        count={3}
        error={false}
        onDownload={onDownload}
        onDiscard={onDiscard}
      />,
    );

    expect(
      screen.getByText(/This browser holds 3 assistant messages/),
    ).toBeTruthy();
    expect(screen.getByText("Download")).toBeTruthy();
    expect(screen.getByText("Discard")).toBeTruthy();
  });

  it("uses singular form when count is 1", () => {
    render(
      <StoredHistoryNotice
        count={1}
        error={false}
        onDownload={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/This browser holds 1 assistant message/),
    ).toBeTruthy();
  });

  it("calls onDownload when Download button is clicked", () => {
    const onDownload = vi.fn();
    render(
      <StoredHistoryNotice
        count={2}
        error={false}
        onDownload={onDownload}
        onDiscard={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Download"));
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it("calls onDiscard when Discard button is clicked", () => {
    const onDiscard = vi.fn();
    render(
      <StoredHistoryNotice
        count={2}
        error={false}
        onDownload={vi.fn()}
        onDiscard={onDiscard}
      />,
    );

    fireEvent.click(screen.getByText("Discard"));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("shows the error line when error is true", () => {
    render(
      <StoredHistoryNotice
        count={2}
        error={true}
        onDownload={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        /The stored messages could not be removed\. Try again\./,
      ),
    ).toBeTruthy();
  });

  it("does not show the error line when error is false", () => {
    render(
      <StoredHistoryNotice
        count={2}
        error={false}
        onDownload={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(
      screen.queryByText(
        /The stored messages could not be removed\. Try again\./,
      ),
    ).toBeNull();
  });

  it("renders the title 'Stored assistant messages'", () => {
    render(
      <StoredHistoryNotice
        count={1}
        error={false}
        onDownload={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(screen.getByText("Stored assistant messages")).toBeTruthy();
  });
});
