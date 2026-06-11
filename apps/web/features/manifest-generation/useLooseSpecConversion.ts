import { useState, useRef, useEffect } from "react";
import {
  getClientLooseSpecConversionUseCase,
  isLocalLLMReady,
  hasServerLLMAccessKey,
} from "../../app/lib/wire.client";
import { resolveExecutionStrategy } from "./useStagedSpecGeneration";

export interface LooseSpecConversionOptions {
  executionStrategy?: "auto" | "local" | "cloud";
  signal?: AbortSignal;
}

export interface UseLooseSpecConversionDependencies {
  getClientUseCase?: typeof getClientLooseSpecConversionUseCase;
  isLocalLLMReady?: typeof isLocalLLMReady;
  hasServerLLMAccessKey?: typeof hasServerLLMAccessKey;
  fetchClient?: typeof fetch;
}

export interface UseLooseSpecConversionReturn {
  convertedConfig: string | null;
  isConverting: boolean;
  error: string | null;
  /** Latest server-side liveness message from the conversion stream, if any. */
  progressMessage: string | null;
  reset: () => void;
  convert: (
    looseSpec: string,
    options?: LooseSpecConversionOptions,
  ) => Promise<{ convertedConfig: string | null; error: string | null }>;
}

export function useLooseSpecConversion(
  deps?: UseLooseSpecConversionDependencies,
): UseLooseSpecConversionReturn {
  const getUseCase =
    deps?.getClientUseCase ?? getClientLooseSpecConversionUseCase;
  const checkLocalLLM = deps?.isLocalLLMReady ?? isLocalLLMReady;
  const checkCloudKeys = deps?.hasServerLLMAccessKey ?? hasServerLLMAccessKey;
  const executeFetch =
    deps?.fetchClient ??
    (typeof window !== "undefined" ? window.fetch.bind(window) : fetch);

  const [convertedConfig, setConvertedConfig] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);

  const abortRef = useRef(false);
  const convertingLockRef = useRef(false);

  useEffect(() => {
    abortRef.current = false;
    return () => {
      abortRef.current = true;
    };
  }, []);

  const reset = () => {
    setConvertedConfig(null);
    setIsConverting(false);
    setError(null);
    setProgressMessage(null);
  };

  const executeCloudConversion = async (
    looseSpec: string,
    signal?: AbortSignal,
  ) => {
    try {
      const response = await executeFetch(
        "/api/manifest/generate/spec/convert",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ looseSpec }),
          signal,
        },
      );

      if (!response.ok) {
        throw new Error(`Cloud API failed: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Response body is empty");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      const handleLine = (
        line: string,
      ): { convertedConfig: string | null; error: string | null } | null => {
        const trimmed = line.trim();
        if (!trimmed) return null;
        try {
          const event = JSON.parse(trimmed);
          if (event.type === "progress") {
            if (typeof event.message === "string") {
              setProgressMessage(event.message);
            }
            return null;
          }
          if (event.type === "done") {
            return { convertedConfig: event.configJson, error: null };
          }
          if (event.type === "error") {
            return { convertedConfig: null, error: event.message };
          }
        } catch {
          // ignore JSON parse errors for incomplete frames
        }
        return null;
      };

      while (!abortRef.current && !signal?.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const settled = handleLine(line);
          if (settled) return settled;
        }
      }

      // Flush the decoder and parse any trailing frame the server may have
      // emitted without a terminating newline.
      buffer += decoder.decode();
      if (buffer.trim()) {
        const settled = handleLine(buffer);
        if (settled) return settled;
      }

      if (abortRef.current || signal?.aborted) {
        reader.cancel().catch(() => {});
        return { convertedConfig: null, error: "Aborted" };
      }
      return { convertedConfig: null, error: "Stream ended unexpectedly" };
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        return { convertedConfig: null, error: "Aborted" };
      }
      return {
        convertedConfig: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  };

  const convert = async (
    looseSpec: string,
    options?: LooseSpecConversionOptions,
  ) => {
    if (convertingLockRef.current) {
      return { convertedConfig: null, error: "Already converting" };
    }
    convertingLockRef.current = true;

    setError(null);
    setConvertedConfig(null);
    setProgressMessage(null);
    setIsConverting(true);

    const controller = new AbortController();
    if (options?.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener("abort", () => controller.abort(), {
          once: true,
        });
      }
    }

    const strategy = options?.executionStrategy ?? "auto";
    const hasLocalLLM = checkLocalLLM();
    const hasCloudKeys = checkCloudKeys();
    const resolved = resolveExecutionStrategy(
      strategy,
      hasLocalLLM,
      hasCloudKeys,
    );

    try {
      if (resolved === "none") {
        const msg = "No LLM provider available.";
        setError(msg);
        return { convertedConfig: null, error: msg };
      }

      if (resolved === "local") {
        try {
          const useCase = getUseCase();

          // Yield to event loop
          await new Promise((r) => setTimeout(r, 0));

          const result = await useCase.execute(looseSpec, {
            signal: controller.signal,
          });

          if (abortRef.current || controller.signal.aborted) {
            return { convertedConfig: null, error: "Aborted" };
          }

          if (result.success) {
            setConvertedConfig(result.value.configJson);
            return { convertedConfig: result.value.configJson, error: null };
          }

          if (hasCloudKeys) {
            setProgressMessage(
              "Local conversion did not produce a config — retrying via cloud",
            );
            const cloudResult = await executeCloudConversion(
              looseSpec,
              controller.signal,
            );
            if (cloudResult.error) {
              setError(cloudResult.error);
            } else {
              setConvertedConfig(cloudResult.convertedConfig);
            }
            return cloudResult;
          }

          throw result.error;
        } catch (localError: unknown) {
          if (abortRef.current || controller.signal.aborted) {
            return { convertedConfig: null, error: "Aborted" };
          }
          if (hasCloudKeys) {
            setProgressMessage("Local conversion failed — retrying via cloud");
            const cloudResult = await executeCloudConversion(
              looseSpec,
              controller.signal,
            );
            if (cloudResult.error) {
              setError(cloudResult.error);
            } else {
              setConvertedConfig(cloudResult.convertedConfig);
            }
            return cloudResult;
          }
          const msg =
            localError instanceof Error
              ? localError.message
              : String(localError);
          setError(msg);
          return { convertedConfig: null, error: msg };
        }
      }

      const cloudResult = await executeCloudConversion(
        looseSpec,
        controller.signal,
      );
      if (cloudResult.error) {
        setError(cloudResult.error);
      } else {
        setConvertedConfig(cloudResult.convertedConfig);
      }
      return cloudResult;
    } catch (e) {
      if (abortRef.current || controller.signal.aborted) {
        return { convertedConfig: null, error: "Aborted" };
      }
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      return { convertedConfig: null, error: msg };
    } finally {
      convertingLockRef.current = false;
      // Always clear loading — leaving it true on an aborted run leaves the UI
      // spinning forever even though no work is in flight.
      setIsConverting(false);
    }
  };

  return {
    convertedConfig,
    isConverting,
    error,
    progressMessage,
    reset,
    convert,
  };
}
