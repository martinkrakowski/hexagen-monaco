import { LogLevel } from "./log-level.js";

export interface LoggerConfig {
  minLevel: LogLevel;
  includeTimestamps: boolean;
}
