// @vitest-environment node
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { BACKENDS, openBackend } from "../../../test-support/platform-backends";
import {
  FREE_PLAN,
  REPO_PLAN,
  isStripeConfigured,
  readStripeConfig,
  shouldUseFreeQuota,
} from "../billing";

describe("billing / entitlement seam", () => {
  it("prices on repos, not seats", () => {
    assert.equal(REPO_PLAN.pricing?.pricedOn, "repos");
    assert.equal(FREE_PLAN.pricing, null);
    assert.equal(FREE_PLAN.repoLimit, 0);
  });

  it("reads Stripe keys from env and never requires a live network", () => {
    const empty = readStripeConfig({});
    assert.equal(isStripeConfigured(empty), false);
    const full = readStripeConfig({
      STRIPE_SECRET_KEY: "sk_test_x",
      STRIPE_WEBHOOK_SECRET: "whsec_x",
      STRIPE_PRICE_REPO_MONTHLY: "price_x",
    });
    assert.equal(isStripeConfigured(full), true);
    assert.equal(full.secretKey, "sk_test_x");
  });
});

describe.each(BACKENDS)("billing store (%s)", (kind) => {
  it("defaults an unknown user to the existing free quota", async () => {
    const backend = await openBackend(kind);
    try {
      const store = backend.store;
      const anon = await store.billing.resolve(null);
      assert.equal(anon.plan, "free");
      assert.equal(shouldUseFreeQuota(anon), true);

      const signedIn = await store.billing.resolve("user-1");
      assert.equal(signedIn.plan, "free");
      assert.equal(shouldUseFreeQuota(signedIn), true);

      const paid = await store.billing.upsert({
        userId: "user-1",
        plan: "repo",
        repoLimit: 3,
        status: "active",
        stripeCustomerId: "cus_test",
        stripeSubscriptionId: "sub_test",
        currentPeriodEnd: Date.now() + 86_400_000,
      });
      assert.equal(paid.plan, "repo");
      assert.equal(shouldUseFreeQuota(paid), false);
      assert.equal((await store.billing.resolve("user-1")).repoLimit, 3);
    } finally {
      await backend.close();
    }
  });

  it("currentPeriodEnd comes back as the number that went in, and null as null", async () => {
    const backend = await openBackend(kind);
    try {
      const store = backend.store;
      await store.billing.upsert({
        userId: "user-1",
        plan: "free",
        repoLimit: 0,
        status: "active",
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        currentPeriodEnd: 1759900000000,
      });
      const resolved = await store.billing.resolve("user-1");
      assert.equal(typeof resolved.currentPeriodEnd, "number");
      assert.equal(resolved.currentPeriodEnd, 1759900000000);

      await store.billing.upsert({
        userId: "user-1",
        plan: "free",
        repoLimit: 0,
        status: "active",
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        currentPeriodEnd: null,
      });
      const nulled = await store.billing.resolve("user-1");
      assert.equal(nulled.currentPeriodEnd, null);
    } finally {
      await backend.close();
    }
  });

  it("upsert is one row per user, the second write wins, another user is untouched", async () => {
    const backend = await openBackend(kind);
    try {
      const store = backend.store;
      await store.billing.upsert({
        userId: "user-1",
        plan: "free",
        repoLimit: 0,
        status: "active",
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        currentPeriodEnd: null,
      });
      await store.billing.upsert({
        userId: "user-1",
        plan: "repo",
        repoLimit: 3,
        status: "active",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        currentPeriodEnd: 1759900000000,
      });
      const count = await backend.db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM entitlements WHERE user_id = ?",
        ["user-1"],
      );
      assert.equal(typeof count?.n, "number");
      assert.equal(count?.n, 1);
      const resolved = await store.billing.resolve("user-1");
      assert.equal(resolved.plan, "repo");
      assert.equal(resolved.repoLimit, 3);
      const other = await store.billing.resolve("user-2");
      assert.equal(other.plan, "free");
    } finally {
      await backend.close();
    }
  });

  it("updated_at is stamped as now", async () => {
    const backend = await openBackend(kind);
    try {
      const store = backend.store;
      const before = Date.now();
      await store.billing.upsert({
        userId: "user-1",
        plan: "free",
        repoLimit: 0,
        status: "active",
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        currentPeriodEnd: null,
      });
      const after = Date.now();
      const row = await backend.db.get<{ u: number }>(
        "SELECT hx_ms(updated_at) AS u FROM entitlements WHERE user_id = ?",
        ["user-1"],
      );
      assert.equal(typeof row?.u, "number");
      assert.ok(
        row!.u >= before - 10_000,
        `updated_at ${row!.u} should be after ${before}`,
      );
      assert.ok(
        row!.u <= after + 10_000,
        `updated_at ${row!.u} should be before ${after}`,
      );
    } finally {
      await backend.close();
    }
  });
});
