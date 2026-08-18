import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createPlatformStore } from "../store";
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

  it("defaults an unknown user to the existing free quota", () => {
    const store = createPlatformStore(":memory:");
    const anon = store.billing.resolve(null);
    assert.equal(anon.plan, "free");
    assert.equal(shouldUseFreeQuota(anon), true);

    const signedIn = store.billing.resolve("user-1");
    assert.equal(signedIn.plan, "free");
    assert.equal(shouldUseFreeQuota(signedIn), true);

    const paid = store.billing.upsert({
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
    assert.equal(store.billing.resolve("user-1").repoLimit, 3);
    store.close();
  });
});
