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
  - name: billing
    type: supporting
`;

const ctx = (name: string) =>
  parseYamlToViewData(YAML).contexts.find((c) => c.name === name)!;

interface ChatBody {
  messages: Array<{ role: string; content: string }>;
}

let chatRequests = 0;
let lastBody: ChatBody | null = null;

const sseAnswer = (text: string) =>
  `data: ${JSON.stringify({ type: "chunk", content: text })}\n` +
  `data: ${JSON.stringify({ type: "done" })}\n`;

const server = setupServer(
  http.post("/api/llm/chat", async ({ request }) => {
    chatRequests += 1;
    lastBody = (await request.json()) as ChatBody;
    return new HttpResponse(sseAnswer("Orders looks well-designed."), {
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
  lastBody = null;
  useContextChatPanel.setState({ selectedContext: null, isOpen: false });
});

describe("ContextGovernanceChatDrawer", () => {
  it("auto-sends a grounded question and streams the answer (verifying the posted payload)", async () => {
    render(<ContextGovernanceChatDrawer />);
    act(() => useContextChatPanel.getState().open(ctx("orders")));

    await waitFor(() => {
      assert.ok(screen.getByText(/review the "orders" bounded context/i));
    });
    await waitFor(() => {
      assert.ok(screen.getByText(/orders looks well-designed\./i));
    });
    assert.strictEqual(
      chatRequests,
      1,
      "the seed question is auto-sent exactly once",
    );

    // Contract check: the optimistic transcript could pass even on a broken
    // request shape, so assert the *posted* payload — the governance grounding
    // (system, including this context's shape) + the orders user turn.
    const messages = lastBody?.messages ?? [];
    assert.deepStrictEqual(
      messages.map((m) => m.role),
      ["system", "user"],
    );
    assert.match(messages[0].content, /hexagonal-architecture governance/i);
    assert.match(messages[0].content, /Name: orders/);
    assert.match(messages[1].content, /review the "orders" bounded context/i);
  });

  it("closes when the close button is clicked", async () => {
    render(<ContextGovernanceChatDrawer />);
    act(() => useContextChatPanel.getState().open(ctx("orders")));
    await waitFor(() => {
      assert.ok(screen.getByText(/orders looks well-designed\./i));
    });

    fireEvent.click(screen.getByRole("button", { name: /close ai chat/i }));
    assert.strictEqual(useContextChatPanel.getState().isOpen, false);
  });

  it("re-seeds with the new context's question when switching mid-stream", async () => {
    // Hold the first (orders) answer open so we can switch contexts while it is
    // still streaming — the bug was that the reset send no-op'd during a stream,
    // leaving the new context unseeded.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    server.use(
      http.post("/api/llm/chat", async ({ request }) => {
        chatRequests += 1;
        lastBody = (await request.json()) as ChatBody;
        if (chatRequests === 1) await gate;
        return new HttpResponse(sseAnswer("answer."), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
    );

    render(<ContextGovernanceChatDrawer />);
    act(() => useContextChatPanel.getState().open(ctx("orders")));
    await waitFor(() => {
      assert.ok(screen.getByText(/review the "orders" bounded context/i));
    });

    // Switch to billing while orders is still streaming.
    act(() => useContextChatPanel.getState().open(ctx("billing")));
    await waitFor(() => {
      assert.ok(screen.getByText(/review the "billing" bounded context/i));
    });
    assert.strictEqual(chatRequests, 2, "switching contexts sent the new seed");

    release();
    await waitFor(() => {
      assert.ok(screen.getByText(/answer\./i));
    });
  });

  it("is inert (non-interactive) while closed", () => {
    const { container } = render(<ContextGovernanceChatDrawer />);
    const dialog = container.querySelector('[role="dialog"]');
    assert.ok(dialog, "the drawer renders");
    assert.ok(dialog!.hasAttribute("inert"), "the closed drawer is inert");
  });

  it("store reset clears the selected context and closes the drawer", () => {
    act(() => useContextChatPanel.getState().open(ctx("orders")));
    assert.strictEqual(useContextChatPanel.getState().isOpen, true);

    act(() => useContextChatPanel.getState().reset());
    const state = useContextChatPanel.getState();
    assert.strictEqual(state.isOpen, false);
    assert.strictEqual(state.selectedContext, null);
  });

  it("surfaces an error when the stream ends with no content (empty completion)", async () => {
    server.use(
      http.post(
        "/api/llm/chat",
        () =>
          // Only a terminal `done` frame — no chunks, no error. This models a
          // provider empty-output the server retry couldn't recover (or the BYOK
          // path, which bypasses that retry). The hook must surface an error
          // rather than leave a silent empty assistant bubble.
          new HttpResponse(`data: ${JSON.stringify({ type: "done" })}\n\n`, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
      ),
    );
    render(<ContextGovernanceChatDrawer />);
    act(() => useContextChatPanel.getState().open(ctx("orders")));
    // The message shows in both the error line and the assistant bubble, so
    // assert at least one match rather than a unique one.
    await waitFor(() => {
      assert.ok(screen.getAllByText(/returned no response/i).length > 0);
    });
  });

  it("surfaces an error when the only content is whitespace", async () => {
    server.use(
      http.post(
        "/api/llm/chat",
        () =>
          // A completion of only whitespace is no answer — treat it as empty.
          new HttpResponse(
            `data: ${JSON.stringify({ type: "chunk", content: "  \n\t " })}\n` +
              `data: ${JSON.stringify({ type: "done" })}\n`,
            { status: 200, headers: { "Content-Type": "text/event-stream" } },
          ),
      ),
    );
    render(<ContextGovernanceChatDrawer />);
    act(() => useContextChatPanel.getState().open(ctx("orders")));
    await waitFor(() => {
      assert.ok(screen.getAllByText(/returned no response/i).length > 0);
    });
  });

  it("renders a trailing SSE frame that has no final newline", async () => {
    server.use(
      http.post(
        "/api/llm/chat",
        () =>
          // The last chunk has NO trailing newline — without flushing the
          // leftover buffer it would be dropped.
          new HttpResponse(
            `data: ${JSON.stringify({ type: "chunk", content: "first " })}\n` +
              `data: ${JSON.stringify({ type: "chunk", content: "tail-no-newline" })}`,
            { status: 200, headers: { "Content-Type": "text/event-stream" } },
          ),
      ),
    );
    render(<ContextGovernanceChatDrawer />);
    act(() => useContextChatPanel.getState().open(ctx("orders")));
    await waitFor(() => {
      assert.ok(screen.getByText(/first tail-no-newline/i));
    });
  });
});
