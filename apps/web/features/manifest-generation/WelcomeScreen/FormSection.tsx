import { DescriptionInput } from "./DescriptionInput";
import { ExampleCardsSection } from "./ExampleCardsSection";
import { AdvancedOptionsSection } from "./AdvancedOptionsSection";
import type { FormSectionProps } from "./types";

export function FormSection({
  description,
  onDescriptionChange,
  platform,
  onPlatformChange,
  deployment,
  onDeploymentChange,
  selectedExample,
  onUseExample,
  charCount,
  isValid,
  isDisabled,
}: FormSectionProps) {
  return (
    <div className="space-y-4">
      <DescriptionInput
        value={description}
        onChange={onDescriptionChange}
        charCount={charCount}
        disabled={isDisabled}
      />

      <ExampleCardsSection
        selectedExample={selectedExample}
        onUseExample={onUseExample}
        isDisabled={isDisabled}
      />

      <AdvancedOptionsSection
        platform={platform}
        onPlatformChange={onPlatformChange}
        deployment={deployment}
        onDeploymentChange={onDeploymentChange}
        isDisabled={isDisabled}
      />
    </div>
  );
}
