import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { StoredHistoryNotice, type NoticeError } from "./StoredHistoryNotice";

describe("StoredHistoryNotice", () => {
  it("renders the count and both buttons", () => {
    const onDownload = vi.fn();
    const onDiscard = vi.fn();

    render(
      <StoredHistoryNotice
        count={3}
        error={null}
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
        error={null}
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
        error={null}
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
        error={null}
        onDownload={vi.fn()}
        onDiscard={onDiscard}
      />,
    );

    fireEvent.click(screen.getByText("Discard"));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("shows the discard error text when error is 'discard'", () => {
    render(
      <StoredHistoryNotice
        count={2}
        error={"discard" as NoticeError}
        onDownload={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        /The stored messages could not be removed\. Try again\./,
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText(/The messages could not be prepared for download\./),
    ).toBeNull();
  });

  it("shows the download error text when error is 'download'", () => {
    render(
      <StoredHistoryNotice
        count={2}
        error={"download" as NoticeError}
        onDownload={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/The messages could not be prepared for download\./),
    ).toBeTruthy();
    expect(
      screen.queryByText(
        /The stored messages could not be removed\. Try again\./,
      ),
    ).toBeNull();
  });

  it("does not show any error text when error is null", () => {
    render(
      <StoredHistoryNotice
        count={2}
        error={null}
        onDownload={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(
      screen.queryByText(
        /The stored messages could not be removed\. Try again\./,
      ),
    ).toBeNull();
    expect(
      screen.queryByText(/The messages could not be prepared for download\./),
    ).toBeNull();
  });

  it("renders the title 'Stored assistant messages'", () => {
    render(
      <StoredHistoryNotice
        count={1}
        error={null}
        onDownload={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(screen.getByText("Stored assistant messages")).toBeTruthy();
  });
});
