import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth.js";
import { getMetadataAdapter } from "@/lib/byok-wire.js";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const metadataAdapter = getMetadataAdapter();
  const result = await metadataAdapter.hasKeys(session.user.sub);

  if (!result.success) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  return NextResponse.json({ hasKeys: result.value });
}
