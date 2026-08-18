import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  return {
    getServerSession: vi.fn(),
    getMetadataAdapter: vi.fn(),
    findByUserAndProvider: vi.fn(),
    resolveActiveGenerationModel: vi.fn(),
  };
});

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth.js", () => ({
  authOptions: {},
}));

vi.mock("@/lib/byok-wire.js", () => ({
  getMetadataAdapter: mocks.getMetadataAdapter,
}));

vi.mock("../../../lib/wire.server", () => ({
  resolveActiveGenerationModel: mocks.resolveActiveGenerationModel,
}));

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = "";
  process.env.ANTHROPIC_API_KEY = "";
  process.env.COHERE_API_KEY = "";

  mocks.getMetadataAdapter.mockReturnValue({
    findByUserAndProvider: mocks.findByUserAndProvider,
  });

  mocks.resolveActiveGenerationModel.mockReturnValue("test-model");
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

test("hasByokKey correctly reflects per-provider status rather than an aggregate", async () => {
  mocks.getServerSession.mockResolvedValue({ user: { sub: "test-user-1" } });

  mocks.findByUserAndProvider.mockImplementation(
    async (userId: string, provider: string) => {
      if (provider === "openai") {
        return { success: true, value: { revokedAt: null } }; // active key
      }
      return { success: true, value: null }; // no key
    },
  );

  const { GET } = await import("../route");

  const res = await GET();
  expect(res.status).toBe(200);

  const payload = await res.json();

  const openaiCap = payload.capabilities.find(
    (c: { provider: string }) => c.provider === "openai",
  );
  const anthropicCap = payload.capabilities.find(
    (c: { provider: string }) => c.provider === "anthropic",
  );

  expect(openaiCap.hasByokKey).toBe(true);
  expect(anthropicCap.hasByokKey).toBe(false);
  expect(openaiCap.status).toBe("byok_key");
  expect(anthropicCap.status).toBe("no_keys_configured");
});

test("a provider that throws is a 500", async () => {
  mocks.getServerSession.mockResolvedValue({ user: { sub: "test-user-1" } });

  mocks.findByUserAndProvider.mockImplementation(
    async (_userId: string, _provider: string) => {
      return { success: false, error: new Error("db down") };
    },
  );

  const { GET } = await import("../route");

  const res = await GET();
  expect(res.status).toBe(500);

  const payload = await res.json();
  expect(payload.error).toBe("db down");
});
