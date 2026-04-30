/**
 * Hook for managing manifest generation from natural language
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { classifyError, ERROR_MESSAGES, ErrorCategory } from "./errorMessages";

interface GenerationMetadata {
  model: string;
  processingTime: number;
  tokensUsed: number;
}

interface GeneratedManifest {
  manifest: string;
  confidence: number;
  suggestions: string[];
  warnings: string[];
  metadata: GenerationMetadata;
}

interface GenerationState {
  status: "idle" | "generating" | "success" | "error";
  result: GeneratedManifest | null;
  error: string | null;
  errorCategory: ErrorCategory | null;
  retryCount: number;
}

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

export function useManifestGeneration() {
  const [state, setState] = useState<GenerationState>({
    status: "idle",
    result: null,
    error: null,
    errorCategory: null,
    retryCount: 0,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  const generate = useCallback(
    async (
      description: string,
      options?: {
        language?: string;
        platform?: string;
        deployment?: string;
        additionalContext?: string;
      },
      attempt = 0
    ) => {
      // Clear any pending retry timeouts to prevent race conditions
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      
      setState((prev) => ({
        ...prev,
        status: "generating",
        retryCount: attempt,
      }));

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      try {
        const fetchPromise = fetch("/api/manifest/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            description,
            ...options,
          }),
          signal: abortControllerRef.current.signal,
        });

        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutRef.current = setTimeout(() => {
            abortControllerRef.current?.abort();
            reject(new Error("Request timeout"));
          }, 30000);
        });

        const response = await Promise.race([fetchPromise, timeoutPromise]);
        
        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        let data;
        let parsingError = false;
        try {
          data = await response.json();
        } catch {
          parsingError = true;
        }

        if (!response.ok || !data?.success || parsingError) {
          const status = response.status;
          const category = classifyError(parsingError ? new Error("json") : null, status);
          
          const isTransient = category === "NETWORK" || category === "TIMEOUT" || category === "RATE_LIMIT" || status >= 500;
          
          if (isTransient && attempt < MAX_RETRIES) {
            const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt);
            timeoutRef.current = setTimeout(() => {
              generate(description, options, attempt + 1).catch(() => {});
            }, backoff);
            return;
          }

          const errorMessage = data?.error || data?.details || ERROR_MESSAGES[category];
          setState({
            status: "error",
            result: null,
            error: errorMessage,
            errorCategory: category,
            retryCount: attempt,
          });
          return;
        }

        setState({
          status: "success",
          result: {
            manifest: data.manifest,
            confidence: data.confidence,
            suggestions: data.suggestions,
            warnings: data.warnings,
            metadata: data.metadata,
          },
          error: null,
          errorCategory: null,
          retryCount: attempt,
        });
      } catch (error) {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        const category = classifyError(error);
        const isTransient = category === "NETWORK" || category === "TIMEOUT";

        if (isTransient && attempt < MAX_RETRIES) {
          const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt);
          timeoutRef.current = setTimeout(() => {
            generate(description, options, attempt + 1).catch(() => {});
          }, backoff);
          return;
        }

        setState({
          status: "error",
          result: null,
          error: ERROR_MESSAGES[category],
          errorCategory: category,
          retryCount: attempt,
        });
      }
    },
    [],
  );

  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setState({ status: "idle", result: null, error: null, errorCategory: null, retryCount: 0 });
  }, []);

  return {
    ...state,
    generate,
    reset,
    isGenerating: state.status === "generating",
    isSuccess: state.status === "success",
    isError: state.status === "error",
  };
}

// Made with Bob
