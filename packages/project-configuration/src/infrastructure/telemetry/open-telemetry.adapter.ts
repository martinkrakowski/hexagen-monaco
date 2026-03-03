import type { ITelemetryPort } from '@hexagen/project-configuration';

export class OpenTelemetryAdapter implements ITelemetryPort {
  recordMetric(name: string, value: number): void {
    // TODO: implement real OpenTelemetry metric recording
    `[Telemetry] Metric: ${name} = ${value}`;
  }

  async trace(name: string, fn: () => Promise<void>): Promise<void> {
    // TODO: implement real OpenTelemetry tracing
    `[Telemetry] Trace start: ${name}`;
    await fn();
    `[Telemetry] Trace end: ${name}`;
  }
}
