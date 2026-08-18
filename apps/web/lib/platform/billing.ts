import type Database from "better-sqlite3";

export const BILLING_PLANS = ["free", "repo"] as const;
export type BillingPlan = (typeof BILLING_PLANS)[number];

export const ENTITLEMENT_STATUSES = [
  "none",
  "active",
  "past_due",
  "canceled",
] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

export interface RepoPricing {
  readonly pricedOn: "repos";
  readonly monthlyUsdPerRepo: number;
  readonly includedRepos: number;
}

export interface PlanDefinition {
  readonly plan: BillingPlan;
  readonly repoLimit: number;
  readonly pricing: RepoPricing | null;
}

export interface Entitlement {
  readonly userId: string | null;
  readonly plan: BillingPlan;
  readonly repoLimit: number;
  readonly status: EntitlementStatus;
  readonly stripeCustomerId: string | null;
  readonly stripeSubscriptionId: string | null;
  readonly currentPeriodEnd: number | null;
}

export interface StripeConfig {
  readonly secretKey: string | null;
  readonly webhookSecret: string | null;
  readonly priceIdRepoMonthly: string | null;
}

export const FREE_PLAN: PlanDefinition = {
  plan: "free",
  repoLimit: 0,
  pricing: null,
};

export const REPO_PLAN: PlanDefinition = {
  plan: "repo",
  repoLimit: 1,
  pricing: {
    pricedOn: "repos",
    monthlyUsdPerRepo: 29,
    includedRepos: 1,
  },
};

const FREE_ENTITLEMENT: Entitlement = {
  userId: null,
  plan: "free",
  repoLimit: 0,
  status: "none",
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  currentPeriodEnd: null,
};

export function readStripeConfig(
  env: NodeJS.ProcessEnv = process.env,
): StripeConfig {
  return {
    secretKey: env.STRIPE_SECRET_KEY || null,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || null,
    priceIdRepoMonthly: env.STRIPE_PRICE_REPO_MONTHLY || null,
  };
}

export function isStripeConfigured(config: StripeConfig): boolean {
  return Boolean(
    config.secretKey && config.webhookSecret && config.priceIdRepoMonthly,
  );
}

interface EntitlementRow {
  user_id: string;
  plan: string;
  repo_limit: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string;
  current_period_end: number | null;
}

function isBillingPlan(value: string): value is BillingPlan {
  return (BILLING_PLANS as readonly string[]).includes(value);
}

function isEntitlementStatus(value: string): value is EntitlementStatus {
  return (ENTITLEMENT_STATUSES as readonly string[]).includes(value);
}

function rowToEntitlement(row: EntitlementRow): Entitlement {
  return {
    userId: row.user_id,
    plan: isBillingPlan(row.plan) ? row.plan : "free",
    repoLimit: row.repo_limit,
    status: isEntitlementStatus(row.status) ? row.status : "none",
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    currentPeriodEnd: row.current_period_end,
  };
}

export interface EntitlementRepository {
  resolve(userId: string | null): Entitlement;
  upsert(entitlement: Entitlement & { userId: string }): Entitlement;
}

export function createEntitlementRepository(
  db: Database.Database,
): EntitlementRepository {
  const select = db.prepare("SELECT * FROM entitlements WHERE user_id = ?");
  const upsert = db.prepare(`
    INSERT INTO entitlements (
      user_id, plan, repo_limit, stripe_customer_id, stripe_subscription_id,
      status, current_period_end, updated_at
    ) VALUES (
      @user_id, @plan, @repo_limit, @stripe_customer_id, @stripe_subscription_id,
      @status, @current_period_end, @updated_at
    )
    ON CONFLICT(user_id) DO UPDATE SET
      plan = excluded.plan,
      repo_limit = excluded.repo_limit,
      stripe_customer_id = excluded.stripe_customer_id,
      stripe_subscription_id = excluded.stripe_subscription_id,
      status = excluded.status,
      current_period_end = excluded.current_period_end,
      updated_at = excluded.updated_at
  `);

  return {
    resolve(userId) {
      if (!userId) return FREE_ENTITLEMENT;
      const row = select.get(userId) as EntitlementRow | undefined;
      if (!row) {
        return { ...FREE_ENTITLEMENT, userId };
      }
      return rowToEntitlement(row);
    },
    upsert(entitlement) {
      upsert.run({
        user_id: entitlement.userId,
        plan: entitlement.plan,
        repo_limit: entitlement.repoLimit,
        stripe_customer_id: entitlement.stripeCustomerId,
        stripe_subscription_id: entitlement.stripeSubscriptionId,
        status: entitlement.status,
        current_period_end: entitlement.currentPeriodEnd,
        updated_at: Date.now(),
      });
      return this.resolve(entitlement.userId);
    },
  };
}

/**
 * Future generate-route gate. Defaults to the existing free quota — never an
 * unlimited signed-in bypass (quota-D2).
 */
export function shouldUseFreeQuota(entitlement: Entitlement): boolean {
  return entitlement.plan === "free" || entitlement.status !== "active";
}
