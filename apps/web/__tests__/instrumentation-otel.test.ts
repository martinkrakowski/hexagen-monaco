import { describe, expect, it, vi } from "vitest";

const telemetry = vi.hoisted(() => ({
  loaded: false,
  registerOtlpTelemetry: vi.fn(),
}));

vi.mock("../lib/telemetry.node", () => {
  telemetry.loaded = true;
  return { registerOtlpTelemetry: telemetry.registerOtlpTelemetry };
});

async function freshRegister(): Promise<() => Promise<void>> {
  vi.resetModules();
  telemetry.loaded = false;
  telemetry.registerOtlpTelemetry.mockClear();
  const mod = await import("../instrumentation");
  return mod.register;
}

describe("register() OpenTelemetry gate", () => {
  it("does not load the telemetry module when OTEL_EXPORTER_OTLP_ENDPOINT is unset", async () => {
    const savedEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const savedRuntime = process.env.NEXT_RUNTIME;
    try {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      process.env.NEXT_RUNTIME = "nodejs";
      const register = await freshRegister();
      await register();
      expect(telemetry.loaded).toBe(false);
      expect(telemetry.registerOtlpTelemetry).not.toHaveBeenCalled();
    } finally {
      if (savedEndpoint === undefined) {
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      } else {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = savedEndpoint;
      }
      if (savedRuntime === undefined) delete process.env.NEXT_RUNTIME;
      else process.env.NEXT_RUNTIME = savedRuntime;
    }
  });

  it("registers the OTLP tracer when an endpoint is set", async () => {
    const savedEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const savedRuntime = process.env.NEXT_RUNTIME;
    try {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://alloy:4318";
      process.env.NEXT_RUNTIME = "nodejs";
      const register = await freshRegister();
      await register();
      expect(telemetry.loaded).toBe(true);
      expect(telemetry.registerOtlpTelemetry).toHaveBeenCalledTimes(1);
    } finally {
      if (savedEndpoint === undefined) {
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      } else {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = savedEndpoint;
      }
      if (savedRuntime === undefined) delete process.env.NEXT_RUNTIME;
      else process.env.NEXT_RUNTIME = savedRuntime;
    }
  });
});
