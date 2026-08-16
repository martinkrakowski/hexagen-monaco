import type { EnvironmentReaderPort } from "../application/ports/environment-reader.port.js";

/**
 * `EnvironmentReaderPort` backed by the host process environment.
 *
 * `process.env[name]` is the whole capability; whether the result counts as a
 * missing env var is the use case's call.
 */
export class ProcessEnvironmentReader implements EnvironmentReaderPort {
  get(name: string): string | undefined {
    return process.env[name];
  }
}
