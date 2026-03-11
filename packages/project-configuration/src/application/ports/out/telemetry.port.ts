export interface TelemetryPort {
  trace(name: string, fn: () => Promise<void>): Promise<void>;
  // TODO: Add more telemetry methods as needed
}
