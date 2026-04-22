import noInformationState from "./rules/no-information-state.js";
import noKernelImports from "./rules/no-kernel-imports.js";
import noFeatureSliceImports from "./rules/no-feature-slice-imports.js";

export const rules = {
  "no-information-state": noInformationState,
  "no-kernel-imports": noKernelImports,
  "no-feature-slice-imports": noFeatureSliceImports,
};

export default { rules };
