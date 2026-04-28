import { Branded } from "@hexagen/shared";
import { FeatureIdValidationError } from "../errors.js";

export type FeatureId = Branded<string, "FeatureId">;

export const createFeatureId = (raw: string): FeatureId => {
  if (!raw || raw.trim().length === 0) {
    throw new FeatureIdValidationError(raw);
  }
  return raw as FeatureId;
};

export const featureIdValue = (id: FeatureId): string => id as unknown as string;
