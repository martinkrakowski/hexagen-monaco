import noInformationState from "./rules/no-information-state.js";
import noKernelImports from "./rules/no-kernel-imports.js";
import noFeatureSliceImports from "./rules/no-feature-slice-imports.js";
import noArbitraryTailwindValues from "./rules/no-arbitrary-tailwind-values.js";
import noOffScaleSpacing from "./rules/no-off-scale-spacing.js";
import rhfStableArrayKeys from "./rules/rhf-stable-array-keys.js";
import noChildrenWrapperTypeSwap from "./rules/no-children-wrapper-type-swap.js";

export const rules = {
  "no-information-state": noInformationState,
  "no-kernel-imports": noKernelImports,
  "no-feature-slice-imports": noFeatureSliceImports,
  "no-arbitrary-tailwind-values": noArbitraryTailwindValues,
  "no-off-scale-spacing": noOffScaleSpacing,
  "rhf-stable-array-keys": rhfStableArrayKeys,
  "no-children-wrapper-type-swap": noChildrenWrapperTypeSwap,
};

export default { rules };
