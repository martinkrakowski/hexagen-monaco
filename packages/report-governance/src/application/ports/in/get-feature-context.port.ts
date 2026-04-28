import type { FeatureId } from "../../../domain/value-objects/feature-id.js";
import type { FeatureReport } from "../../../domain/index.js";

export interface GetFeatureContextPort {
  execute(featureId: FeatureId, projectRoot: string): Promise<FeatureReport | null>;
}
