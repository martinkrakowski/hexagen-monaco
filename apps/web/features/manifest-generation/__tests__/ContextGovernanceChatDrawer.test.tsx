import React, { act } from "react";
import { describe, it, beforeAll, afterAll, afterEach } from "vitest";
import assert from "node:assert";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { parseYamlToViewData } from "@hexagen/manifest-generation";
import { ContextGovernanceChatDrawer } from "../ContextGovernanceChatDrawer";
import { useContextChatPanel } from "../store/useContextChatPanel";

const YAML = `bounded_contexts:
  - name: orders
    type: core
`;

const orders = () => parseYamlToViewData(YAML).contexts[0];

let chatRequests = 0;

// The route streams `data: {type,content|done}` frames; streamCloudChatResponse
// splits on "\n" and reads `data: ` lines.
const server = setupServer(
  http.post("/api/llm/chat", async () => {
    chatRequests += 1;
    const body =
      `data: ${JSON.stringify({ type: "chunk", content: "Orders looks " })}\n` +
      `data: ${JSON.stringify({ type: "chunk", content: "well-designed." })}\n` +
      `data: ${JSON.stringify({ type: "done" })}\n`;
    return new HttpResponse(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }),
);

beforeAll(() => server.listen());
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  cleanup();
  chatRequests = 0;
  useContextChatPanel.setState({ selectedContext: null, isOpen: false });
});

describe("ContextGovernanceChatDrawer", () => {
  it("auto-sends a grounded question for the opened context and streams the answer", async () => {
    render(<ContextGovernanceChatDrawer />);
    act(() => useContextChatPanel.getState().open(orders()));

    // The seeded governance question is sent (shown as the user message)…
    await waitFor(() => {
      assert.ok(screen.getByText(/review the "orders" bounded context/i));
    });
    // …and the streamed answer renders.
    await waitFor(() => {
      assert.ok(screen.getByText(/orders looks well-designed\./i));
    });
    assert.strictEqual(
      chatRequests,
      1,
      "the seed question is auto-sent exactly once",
    );
  });

  it("closes when the close button is clicked", async () => {
    render(<ContextGovernanceChatDrawer />);
    act(() => useContextChatPanel.getState().open(orders()));
    await waitFor(() => {
      assert.ok(screen.getByText(/orders looks well-designed\./i));
    });

    fireEvent.click(screen.getByRole("button", { name: /close ai chat/i }));
    assert.strictEqual(useContextChatPanel.getState().isOpen, false);
  });
});
