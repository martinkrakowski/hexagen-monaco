import { NextResponse } from "next/server";
import { langGraphAdapter } from "../../../../src/infrastructure/langgraph";

/**
 * POST /api/agent/resume
 *
 * Body: { threadId: string, humanInput: string }
 * Returns: same shape as /invoke (`{ result, steps, threadId }` on success).
 *
 * Continues a graph that previously paused at the `human-review` node.
 * The threadId is the one returned by the original /invoke call —
 * carry it through your UI as a hidden field on the review form. The
 * checkpointer (memory/supabase/redis/postgres) must be cross-request
 * for this to work; memory mode only resumes within the same process.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", kind: "invalid-input" },
      { status: 400 },
    );
  }
  const { threadId, humanInput } = (body ?? {}) as {
    threadId?: unknown;
    humanInput?: unknown;
  };
  if (typeof threadId !== "string" || threadId.length === 0) {
    return NextResponse.json(
      { error: "`threadId` (non-empty string) is required", kind: "invalid-input" },
      { status: 400 },
    );
  }
  if (typeof humanInput !== "string") {
    return NextResponse.json(
      { error: "`humanInput` (string) is required", kind: "invalid-input" },
      { status: 400 },
    );
  }
  if (!langGraphAdapter.resume) {
    // Adapter built without resume support — surface clearly rather than 500.
    return NextResponse.json(
      {
        error: "Resume is not enabled on this adapter",
        kind: "invalid-input",
      },
      { status: 501 },
    );
  }
  // resume() writes ONLY humanInput as a partial state update. The
  // checkpointer restores the rest of the paused state (including the
  // original `input` prompt) for the matching thread_id, so the original
  // user question is preserved instead of being overwritten by the
  // reviewer's text.
  const result = await langGraphAdapter.resume(threadId, humanInput);
  if (!result.ok) {
    const status = result.error.kind === "invalid-input" ? 400 : 500;
    return NextResponse.json(
      { error: result.error.message, kind: result.error.kind },
      { status },
    );
  }
  return NextResponse.json(result.value);
}
