import {
  CORRELATION_ID_HEADER,
  getOrCreateCorrelationId,
} from "../../src/infrastructure/logging/correlation";
import { runWithContext } from "../../src/infrastructure/logging/context";
import { logger } from "../../src/infrastructure/logging/logger";

// Minimal structural shapes so this stays framework-agnostic (no express/next
// type dependency). They match the Connect/Express req/res surface we use.
interface RequestLike {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}
interface ResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): void;
  on(event: "finish", listener: () => void): void;
}

/**
 * Connect/Express-style middleware: assigns a correlation id, echoes it on the
 * response header, runs the handler chain inside the request context, and emits
 * one structured line per request when the response finishes.
 */
export function requestLoggerMiddleware(
  req: RequestLike,
  res: ResponseLike,
  next: () => void,
): void {
  const requestId = getOrCreateCorrelationId((name) => {
    const value = req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  });
  const startedAt = Date.now();
  res.setHeader(CORRELATION_ID_HEADER, requestId);

  res.on("finish", () => {
    logger.info({
      type: "request",
      method: req.method,
      // Log the path only — strip the query string so secrets passed as query
      // params (e.g. ?token=...) never reach the logs. Redaction is key-based
      // and cannot scrub values embedded inside a URL string.
      path: req.url?.split("?")[0],
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      requestId,
    });
  });

  runWithContext({ requestId, startedAt }, next);
}
