// Next.js instrumentation hook — runs once at server startup. Boots the
// OpenTelemetry Node SDK in the Node.js runtime only (not Edge).
//
// The OTel packages are optional peers — install them when you enable tracing:
//   npm install @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http \
//     @opentelemetry/auto-instrumentations-node
// Their specifiers are held in variables so a project that hasn't installed them
// still typechecks; registration is skipped if they're missing at runtime. The
// `webpackIgnore` hints keep Next.js/Webpack from trying to resolve these
// optional imports at build time (which would emit a "Critical dependency"
// warning); they are left as native runtime imports.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const sdkModule: string = "@opentelemetry/sdk-node";
  const otlpModule: string = "@opentelemetry/exporter-trace-otlp-http";
  const autoModule: string = "@opentelemetry/auto-instrumentations-node";

  try {
    const { NodeSDK } = (await import(/* webpackIgnore: true */ sdkModule)) as {
      NodeSDK: new (config: unknown) => { start(): void };
    };
    const { OTLPTraceExporter } = (await import(
      /* webpackIgnore: true */ otlpModule
    )) as {
      OTLPTraceExporter: new (config: unknown) => unknown;
    };
    const { getNodeAutoInstrumentations } = (await import(
      /* webpackIgnore: true */ autoModule
    )) as {
      getNodeAutoInstrumentations: () => unknown;
    };

    const sdk = new NodeSDK({
      serviceName: process.env.OTEL_SERVICE_NAME ?? "app",
      traceExporter: new OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      }),
      instrumentations: [getNodeAutoInstrumentations()],
    });
    sdk.start();
  } catch (err) {
    // A missing optional package is the expected "tracing not installed" case —
    // stay silent. Surface anything else (a real bootstrap failure) so it is not
    // swallowed behind the optional-dependency guard.
    const code = (err as { code?: string }).code;
    if (code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") {
      console.warn("[instrumentation] OpenTelemetry bootstrap failed:", err);
    }
  }
}
