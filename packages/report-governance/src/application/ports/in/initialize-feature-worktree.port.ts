import type { FeatureId } from "../../../domain/value-objects/feature-id.js";
import type { FeatureReport } from "../../../domain/index.js";

export interface InitializeFeatureWorktreePort {
  execute(featureId: FeatureId, projectRoot: string): Promise<FeatureReport>;
}
