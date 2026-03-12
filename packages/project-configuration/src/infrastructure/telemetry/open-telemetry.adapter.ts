import type { TelemetryPort } from "../../application/ports/out/telemetry.port.js";

export class OpenTelemetryAdapter implements TelemetryPort {
  recordMetric(name: string, value: number): void {
    // TODO: implement real OpenTelemetry metric recording
    // eslint-disable-next-line no-console
    console.log(`[Telemetry] Metric: ${name} = ${value}`);
  }

  async trace(name: string, fn: () => Promise<void>): Promise<void> {
    // TODO: implement real OpenTelemetry tracing
    // eslint-disable-next-line no-console
    console.log(`[Telemetry] Trace start: ${name}`);
    await fn();
    // eslint-disable-next-line no-console
    console.log(`[Telemetry] Trace end: ${name}`);
  }
}
