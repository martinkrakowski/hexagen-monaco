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
import { ContextGovernanceChatPanel } from "../ContextGovernanceChatPanel";
import { useContextChatPanel } from "../store/useContextChatPanel";

const YAML = `bounded_contexts:
  - name: orders
    type: core
`;

const ctx = (name: string) =>
  parseYamlToViewData(YAML).contexts.find((c) => c.name === name)!;

const sseAnswer = (text: string) =>
  `data: ${JSON.stringify({ type: "chunk", content: text })}\n` +
  `data: ${JSON.stringify({ type: "done" })}\n`;

const server = setupServer(
  http.post(
    "/api/llm/chat",
    () =>
      new HttpResponse(sseAnswer("Orders is cohesive."), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
  ),
);

beforeAll(() => server.listen());
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  cleanup();
  useContextChatPanel.setState({ selectedContext: null, isOpen: false });
});

describe("ContextGovernanceChatPanel", () => {
  it("shows the context in the header and streams the seeded answer", async () => {
    render(<ContextGovernanceChatPanel onRequestCollapse={() => {}} />);
    act(() => useContextChatPanel.getState().open(ctx("orders")));

    await waitFor(() => {
      assert.ok(screen.getByText(/AI · orders/i));
    });
    await waitFor(() => {
      assert.ok(screen.getByText(/orders is cohesive\./i));
    });
  });

  it("calls onRequestCollapse when the collapse chevron is clicked", () => {
    let collapsed = 0;
    render(
      <ContextGovernanceChatPanel onRequestCollapse={() => (collapsed += 1)} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /collapse ai chat/i }));
    assert.strictEqual(collapsed, 1);
  });
});
