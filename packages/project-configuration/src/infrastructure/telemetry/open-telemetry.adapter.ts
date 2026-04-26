import type { TelemetryPort } from "../../application/ports/out/telemetry.port";

export class OpenTelemetryAdapter implements TelemetryPort {
  async trace(_name: string, fn: () => Promise<void>): Promise<void> {
    // TODO: implement real OpenTelemetry tracing
    await fn();
  }
}
