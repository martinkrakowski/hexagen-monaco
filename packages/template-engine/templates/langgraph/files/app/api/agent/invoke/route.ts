import { NextResponse } from "next/server";
import { langGraphAdapter } from "../../../../src/infrastructure/langgraph";

/**
 * POST /api/agent/invoke
 *
 * Body: { prompt: string, threadId?: string, context?: string }
 * Returns: { result: string, steps: string[], threadId: string } on success,
 *          { error: string, kind: string } on failure.
 *
 * Re-use a returned `threadId` on a follow-up call to continue the same
 * thread — the checkpointer takes care of restoring the GraphState.
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
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { prompt?: unknown }).prompt !== "string" ||
    ((body as { prompt: string }).prompt).length === 0
  ) {
    return NextResponse.json(
      { error: "`prompt` (non-empty string) is required", kind: "invalid-input" },
      { status: 400 },
    );
  }
  const { prompt, threadId, context } = body as {
    prompt: string;
    threadId?: string;
    context?: string;
  };
  const result = await langGraphAdapter.invoke({ prompt, threadId, context });
  if (!result.ok) {
    const status = result.error.kind === "invalid-input" ? 400 : 500;
    return NextResponse.json(
      { error: result.error.message, kind: result.error.kind },
      { status },
    );
  }
  return NextResponse.json(result.value);
}
