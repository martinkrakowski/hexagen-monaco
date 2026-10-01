import {
  EXIT_ERROR,
  EXIT_INTERRUPTED,
  EXIT_OK,
  EXIT_UNKNOWN,
  errorText,
} from "./errors.js";

export interface UsageDeps {
  readonly get: (pathname: string) => Promise<Response>;
  readonly controller: AbortController;
  /** Aborted from outside (a signal handler). */
  readonly external?: AbortSignal;
  /** True once the caller's deadline has fired and aborted the request. */
  readonly timedOut?: () => boolean;
  readonly session: string;
  readonly log: (text: string) => void;
  readonly logError: (text: string) => void;
}

/** A session record is small; a body past this is not one. */
const MAX_BODY_BYTES = 1024 * 1024;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

async function readBounded(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return "";
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error(
        `the session record is larger than ${MAX_BODY_BYTES} bytes`,
      );
    }
    text += decoder.decode(value, { stream: true });
  }
}

/**
 * One summary of a session: wall seconds, tokens and cost, from
 * `GET /session/<id>`.
 *
 * A field the server did not report is printed as `unknown`, and a reading with
 * ANY unknown field exits 3. Zero is never printed for a value that was merely
 * missing, because an orchestrator that reads `0 tokens` believes the lane was
 * free.
 */
export async function usage(deps: UsageDeps): Promise<number> {
  const interrupted = (): boolean => deps.external?.aborted === true;
  const onExternal = (): void => deps.controller.abort();
  deps.external?.addEventListener("abort", onExternal, { once: true });
  try {
    if (interrupted()) return EXIT_INTERRUPTED;
    const response = await deps.get(`/session/${deps.session}`);
    if (!response.ok) {
      deps.logError(
        `lane-watch: GET /session/${deps.session} answered HTTP ${response.status}` +
          (response.status === 404 ? ": no such session on that server" : ""),
      );
      return EXIT_ERROR;
    }
    let record: unknown;
    try {
      record = JSON.parse(await readBounded(response));
    } catch (error: unknown) {
      deps.logError(
        `lane-watch: the session record is unreadable: ${errorText(error)}`,
      );
      return EXIT_ERROR;
    }
    if (!isObject(record)) {
      deps.logError("lane-watch: the session record is not an object");
      return EXIT_ERROR;
    }
    // A server that answers for another session must not be read as this one.
    if (record.id !== deps.session) {
      deps.logError(
        `lane-watch: asked for session ${deps.session} but the server returned ` +
          `${typeof record.id === "string" ? JSON.stringify(record.id.slice(0, 80)) : "a record with no id"}`,
      );
      return EXIT_ERROR;
    }

    const time = isObject(record.time) ? record.time : {};
    const created = time.created;
    const updated = time.updated;
    const secs =
      isCount(created) && isCount(updated) && updated >= created
        ? (updated - created) / 1000
        : undefined;

    const tokens = isObject(record.tokens) ? record.tokens : {};
    let tokenText: string | undefined;
    if (isCount(tokens.input) && isCount(tokens.output)) {
      tokenText = `input=${tokens.input} output=${tokens.output}`;
      if (isCount(tokens.reasoning))
        tokenText += ` reasoning=${tokens.reasoning}`;
      const cache = isObject(tokens.cache) ? tokens.cache : {};
      if (isCount(cache.read) && isCount(cache.write)) {
        tokenText += ` cache.read=${cache.read} cache.write=${cache.write}`;
      }
    }

    const cost = isCount(record.cost) ? record.cost : undefined;

    deps.log(`session: ${deps.session}`);
    deps.log(`secs: ${secs ?? "unknown"}`);
    deps.log(`tokens: ${tokenText ?? "unknown"}`);
    deps.log(`cost: ${cost ?? "unknown"}`);
    if (secs === undefined || tokenText === undefined || cost === undefined) {
      deps.logError(
        "lane-watch: the reading is incomplete: a field the server did not report is 'unknown'",
      );
      return EXIT_UNKNOWN;
    }
    return EXIT_OK;
  } catch (error: unknown) {
    if (interrupted()) return EXIT_INTERRUPTED;
    if (deps.timedOut?.() === true) {
      deps.logError("lane-watch: timeout: server did not answer within 30 s");
      return EXIT_ERROR;
    }
    deps.logError(`lane-watch: ${errorText(error)}`);
    return EXIT_ERROR;
  } finally {
    deps.external?.removeEventListener("abort", onExternal);
    deps.controller.abort();
  }
}
