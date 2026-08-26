import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

import { getToken } from "next-auth/jwt";
import { GET, POST } from "../route";
import {
  closePlatformStore,
  getPlatformStore,
} from "../../../../../lib/platform";

function signedInAs(sub: string | null): void {
  vi.mocked(getToken).mockResolvedValue(sub ? ({ sub } as never) : null);
}

function getReq(): NextRequest {
  return new NextRequest("http://localhost/api/account/onboarding");
}

function postReq(): NextRequest {
  return new NextRequest("http://localhost/api/account/onboarding", {
    method: "POST",
  });
}

/** `createUser` mints its own id; the JWT `sub` must be what came back. */
function seedUser(): string {
  const user = getPlatformStore().auth.createUser({
    name: "Octo Cat",
    email: "octo@example.test",
    emailVerified: null,
  } as never);
  return user.id;
}

async function onboardedAtOf(res: Response): Promise<string | null> {
  const body = (await res.json()) as { onboardedAt: string | null };
  return body.onboardedAt;
}

describe("P-U0b — /api/account/onboarding", () => {
  beforeEach(() => {
    closePlatformStore();
    vi.mocked(getToken).mockReset();
  });
  afterEach(() => closePlatformStore());

  it("401 without a session, on both methods", async () => {
    signedInAs(null);
    assert.equal((await GET(getReq())).status, 401);
    assert.equal((await POST(postReq())).status, 401);
  });

  it("GET reads null before onboarding ever completed", async () => {
    const userId = seedUser();
    signedInAs(userId);
    const res = await GET(getReq());
    assert.equal(res.status, 200);
    assert.equal(await onboardedAtOf(res), null);
  });

  it("POST stamps completion, and GET reads the same instant back", async () => {
    const userId = seedUser();
    signedInAs(userId);

    const posted = await POST(postReq());
    assert.equal(posted.status, 200);
    const stamped = await onboardedAtOf(posted);
    assert.ok(stamped, "completion must return the timestamp it wrote");
    assert.ok(
      Number.isFinite(Date.parse(stamped)),
      `onboardedAt must be a parseable instant, got ${JSON.stringify(stamped)}`,
    );

    const read = await GET(getReq());
    assert.equal(await onboardedAtOf(read), stamped);
  });

  it("a second POST is 200 with the ORIGINAL timestamp — the stamp never advances", async () => {
    const userId = seedUser();
    signedInAs(userId);

    const first = await POST(postReq());
    assert.equal(first.status, 200);
    const original = await onboardedAtOf(first);
    assert.ok(original);

    // Timestamps carry millisecond precision, so without this pause a
    // non-idempotent second UPDATE could write an identical string and this
    // test would pass by luck. The pause makes regression observable.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const replay = await POST(postReq());
    assert.equal(replay.status, 200, "an already-complete POST is still 200");
    assert.equal(
      await onboardedAtOf(replay),
      original,
      "a replayed completion must return the first completion's timestamp",
    );
    assert.equal(
      await getPlatformStore().auth.getOnboardedAt(userId),
      original,
      "the stored stamp must not move either",
    );
  });
});
