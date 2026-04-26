import { NextRequest, NextResponse } from "next/server";
import { getLogger } from "@/lib/wire";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { transactionId, patches } = body;

    if (!transactionId) {
      return NextResponse.json(
        { success: false, error: "transactionId is required" },
        { status: 400 },
      );
    }

    const logger = getLogger();
    logger.info("[api/architecture/modify/accept] Accepting patches", {
      transactionId,
      patchCount: Array.isArray(patches) ? patches.length : 0,
    });

    return NextResponse.json({
      success: true,
      transactionId,
      status: "accepted",
    });
  } catch (error) {
    const logger = getLogger();
    logger.errorWithException(error, "[api/architecture/modify/accept] Failed");
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
