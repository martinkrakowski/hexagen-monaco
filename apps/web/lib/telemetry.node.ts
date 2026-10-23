// Node-only OTLP tracer registration for the web app. Imported dynamically
// from `instrumentation.ts` when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, so this
// module (and the OpenTelemetry SDK) never loads in the browser or when
// telemetry is disabled.
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { installSigtermFlush } from "./sigterm-flush";

/**
 * The one line logged when telemetry cannot start. Never log the endpoint
 * value alongside it — the value can carry a token or credentials.
 */
function logTracingDisabled(): void {
  console.error("tracing disabled (invalid endpoint)");
}

/**
 * Strips every trailing `/` from `pathname` with a plain loop — the regex
 * form (`/\/+$/`) is flagged for backtracking (Sonar S8786). Same result:
 * `"/"` → `""`, `"/otlp///"` → `"/otlp"`.
 */
function stripTrailingSlashes(pathname: string): string {
  let stripped = pathname;
  while (stripped.endsWith("/")) {
    stripped = stripped.slice(0, -1);
  }
  return stripped;
}

/**
 * Registers a NodeTracerProvider exporting OTLP traces to
 * `<OTEL_EXPORTER_OTLP_ENDPOINT>/v1/traces` (Phoenix through Alloy): the path
 * is appended to the endpoint URL's pathname, keeping its query and
 * credentials.
 *
 * Does nothing when no endpoint is configured. A malformed endpoint, or an
 * exporter that fails to build, logs one line and registers nothing —
 * telemetry must never crash startup. Spans carry no prompt, message,
 * response or user text — only model/provider/operation/token metadata.
 */
export function registerOtlpTelemetry(): void {
  const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "").trim();
  if (!endpoint) return;

  // A malformed endpoint must not crash startup: validate before building
  // anything, and never log the value.
  let base: URL;
  try {
    base = new URL(endpoint);
  } catch {
    logTracingDisabled();
    return;
  }
  // The exporter accepts any scheme and only fails at export time, after
  // tracing is registered: allow HTTP(S) only.
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    logTracingDisabled();
    return;
  }

  // Append to the URL's pathname — never by string concatenation, which
  // would mangle an endpoint that carries a query or credentials.
  base.pathname = `${stripTrailingSlashes(base.pathname)}/v1/traces`;

  let exporter: OTLPTraceExporter;
  try {
    exporter = new OTLPTraceExporter({ url: base.toString() });
  } catch {
    logTracingDisabled();
    return;
  }

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "hexagen-web",
      "openinference.project.name": "hexagen",
      "deployment.environment":
        process.env.OTEL_DEPLOYMENT_ENVIRONMENT || "unknown",
    }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });

  provider.register();

  // Flush pending spans on shutdown so the last request's trace is
  // exported. The handler itself keeps the exit semantics: registering a
  // SIGTERM listener disables Node's default exit, so it exits 143 only
  // when no other listener (e.g. Next.js's own) owns the process exit.
  installSigtermFlush(process, () => provider.shutdown());
}
