import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok } from "@hexagen/shared";

type ByokProvider = "openai" | "anthropic" | "cohere";
type KeyMetadata = {
  keyId: string;
  userId: string;
  provider: ByokProvider;
  keyVersion: number;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
};

const getServerSession = vi.fn();
const findByUserAndProvider = vi.fn();
const hasKeys = vi.fn();
const resolveActiveGenerationModel = vi.fn(() => undefined);

vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}));
vi.mock("@/lib/auth.js", () => ({ authOptions: {} }));
vi.mock("@hexagen/byok", () => ({
  BYOK_PROVIDERS: ["openai", "anthropic", "cohere"],
}));
vi.mock("@/lib/byok-wire.js", () => ({
  getMetadataAdapter: () => ({
    findByUserAndProvider: (...args: unknown[]) =>
      findByUserAndProvider(...args),
    hasKeys: (...args: unknown[]) => hasKeys(...args),
  }),
}));
vi.mock("../../../../lib/wire.server", () => ({
  resolveActiveGenerationModel: () => resolveActiveGenerationModel(),
}));

import { GET } from "../route";

function key(provider: "openai" | "anthropic" | "cohere"): KeyMetadata {
  return {
    keyId: `${provider}-key`,
    userId: "user-1",
    provider,
    keyVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    revokedAt: null,
    revokedBy: null,
  };
}

describe("GET /api/manifest/capabilities — hasByokKey is per-provider", () => {
  beforeEach(() => {
    getServerSession.mockReset();
    findByUserAndProvider.mockReset();
    hasKeys.mockReset();
    resolveActiveGenerationModel.mockReset();
    resolveActiveGenerationModel.mockReturnValue(undefined);
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.COHERE_API_KEY;
  });

  it("reports hasByokKey only for the provider the user actually stored", async () => {
    getServerSession.mockResolvedValue({ user: { sub: "user-1" } });
    // Aggregate would lie: user has ANY key, so every row would be true.
    hasKeys.mockResolvedValue(ok(true));
    findByUserAndProvider.mockImplementation(
      async (_userId: string, provider: string) => {
        if (provider === "openai") return ok(key("openai"));
        return ok(null);
      },
    );

    const res = await GET();
    assert.equal(res.status, 200);
    const body = await res.json();
    const byProvider = Object.fromEntries(
      body.capabilities.map(
        (c: { provider: string; hasByokKey: boolean; status: string }) => [
          c.provider,
          c,
        ],
      ),
    );

    assert.equal(byProvider.openai.hasByokKey, true);
    assert.equal(byProvider.openai.status, "byok_key");
    assert.equal(byProvider.anthropic.hasByokKey, false);
    assert.equal(byProvider.anthropic.status, "no_keys_configured");
    assert.equal(byProvider.cohere.hasByokKey, false);
    assert.equal(byProvider.cohere.status, "no_keys_configured");
  });
});
