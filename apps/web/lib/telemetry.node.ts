// Node-only OTLP tracer registration for the web app. Imported dynamically
// from `instrumentation.ts` when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, so this
// module (and the OpenTelemetry SDK) never loads in the browser or when
// telemetry is disabled.
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

/**
 * Registers a NodeTracerProvider exporting OTLP traces to
 * `<OTEL_EXPORTER_OTLP_ENDPOINT>/v1/traces` (Phoenix through Alloy).
 *
 * Does nothing when no endpoint is configured. Spans carry no prompt, message,
 * response or user text — only model/provider/operation/token metadata.
 */
export function registerOtlpTelemetry(): void {
  const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "").trim();
  if (!endpoint) return;

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "hexagen-web",
      "openinference.project.name": "hexagen",
      "deployment.environment":
        process.env.OTEL_DEPLOYMENT_ENVIRONMENT || "unknown",
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: `${endpoint.replace(/\/+$/, "")}/v1/traces`,
        }),
      ),
    ],
  });

  provider.register();

  // Flush pending spans on shutdown so the last request's trace is exported.
  process.once("SIGTERM", () => {
    void provider.shutdown();
  });
}
