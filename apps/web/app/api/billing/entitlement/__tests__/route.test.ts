import { afterEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { GET } from "../route";
import { closePlatformStore } from "../../../../../lib/platform";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => null),
}));

describe("GET /api/billing/entitlement", () => {
  afterEach(() => closePlatformStore());

  it("returns the free-quota entitlement without a 501", async () => {
    const res = await GET();
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      usesFreeQuota: boolean;
      entitlement: { plan: string };
      plan: { plan: string };
    };
    assert.equal(body.usesFreeQuota, true);
    assert.equal(body.entitlement.plan, "free");
    assert.equal(body.plan.plan, "free");
  });
});
