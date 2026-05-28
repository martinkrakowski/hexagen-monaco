import type { Result } from "@hexagen/shared";
import type {
  ConnectionHealthState,
  LocalModelState,
} from "../../domain/index.js";

export interface PreFlightValidatorOptions {
  prompt: string;
  deviceMemoryGb?: number;
  memoryThresholdGb?: number;
  cloudContextLimit?: number;
}

export interface PreFlightValidationResult {
  success: boolean;
  bypassLocal: boolean;
  bypassCloud?: boolean;
  bypassReason?: "memory_insufficient" | "context_overflow" | "none";
  error?: string;
}

export interface PreFlightValidatorPort {
  validate(
    localModelState: LocalModelState,
    cloudHealthState: ConnectionHealthState,
    options: PreFlightValidatorOptions,
  ): Result<PreFlightValidationResult, Error>;
}
