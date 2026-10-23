import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerOtlpTelemetry } from "../lib/telemetry.node";

// Observe what the module builds instead of letting the real exporter touch
// the network. The tracer provider is faked so `register()` never installs a
// global tracer provider in the test process, and the SIGTERM flush is
// stubbed (it has its own suite: telemetry-node-sigterm.test.ts).
const mocks = vi.hoisted(() => ({
  exporterOptions: [] as Array<{ url?: string }>,
  registered: 0,
}));

vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: class {
    constructor(options?: { url?: string }) {
      mocks.exporterOptions.push(options ?? {});
    }
    export() {
      /* spans never reach a network in tests */
    }
    shutdown() {
      return Promise.resolve();
    }
  },
}));

vi.mock("@opentelemetry/sdk-trace-node", () => ({
  NodeTracerProvider: class {
    register() {
      mocks.registered += 1;
    }
    shutdown() {
      return Promise.resolve();
    }
  },
}));

vi.mock("../lib/sigterm-flush", () => ({
  installSigtermFlush: () => {
    /* the real process must not gain a SIGTERM listener here */
  },
}));

describe("registerOtlpTelemetry (telemetry.node)", () => {
  const savedEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  beforeEach(() => {
    mocks.exporterOptions.length = 0;
    mocks.registered = 0;
  });

  function restoreEndpoint(): void {
    if (savedEndpoint === undefined) {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    } else {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = savedEndpoint;
    }
  }

  it.each(["not-a-valid-url", "ftp://collector.example/otlp"])(
    "registers nothing and does not throw on the endpoint %s",
    (endpoint) => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = endpoint;
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {
        /* swallow the line under test */
      });

      try {
        expect(() => registerOtlpTelemetry()).not.toThrow();

        expect(mocks.exporterOptions).toHaveLength(0);
        expect(mocks.registered).toBe(0);
        // One line, the fixed message — never the endpoint value.
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalledWith(
          "tracing disabled (invalid endpoint)",
        );
        expect(errorSpy.mock.calls[0].join(" ").length).toBeGreaterThan(0);
        expect(errorSpy.mock.calls[0].join(" ")).not.toContain(endpoint);
      } finally {
        errorSpy.mockRestore();
        restoreEndpoint();
      }
    },
  );

  it("appends /v1/traces to the pathname, keeping the query", () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://h/otlp?token=t";

    try {
      registerOtlpTelemetry();

      expect(mocks.exporterOptions).toHaveLength(1);
      expect(mocks.exporterOptions[0].url).toBe(
        "https://h/otlp/v1/traces?token=t",
      );
      expect(mocks.registered).toBe(1);
    } finally {
      restoreEndpoint();
    }
  });
});
