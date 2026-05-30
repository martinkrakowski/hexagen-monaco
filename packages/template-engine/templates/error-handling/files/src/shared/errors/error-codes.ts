/**
 * Centralised error codes — the single source of truth for error identifiers.
 * No magic strings scattered across handlers; this makes HTTP mapping, i18n, and
 * front-end error messaging straightforward.
 */
export enum ErrorCode {
  // Domain
  NOT_FOUND = "NOT_FOUND",
  VALIDATION_FAILED = "VALIDATION_FAILED",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  CONFLICT = "CONFLICT",

  // Application
  USE_CASE_FAILED = "USE_CASE_FAILED",

  // Infrastructure
  EXTERNAL_SERVICE_FAILED = "EXTERNAL_SERVICE_FAILED",
  LLM_TIMEOUT = "LLM_TIMEOUT",
  LLM_RATE_LIMITED = "LLM_RATE_LIMITED",
  LLM_PARSING_FAILED = "LLM_PARSING_FAILED",
  LLM_AUTH_FAILED = "LLM_AUTH_FAILED",

  // Fallback
  INTERNAL = "INTERNAL",
}

/** The layer an error originates from — used to discriminate at boundaries. */
export type ErrorLayer = "domain" | "application" | "infrastructure";
