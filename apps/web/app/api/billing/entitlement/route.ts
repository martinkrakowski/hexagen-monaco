import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import {
  FREE_PLAN,
  REPO_PLAN,
  getPlatformStore,
  shouldUseFreeQuota,
} from "../../../../lib/platform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.sub ?? null;
  const entitlement = getPlatformStore().billing.resolve(userId);
  const plan = entitlement.plan === "repo" ? REPO_PLAN : FREE_PLAN;
  return NextResponse.json({
    entitlement,
    plan,
    usesFreeQuota: shouldUseFreeQuota(entitlement),
  });
}
