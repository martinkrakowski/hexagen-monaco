import type {
  DomainModelId,
  LLMEngineStatus,
  ModelMetadata,
} from "@hexagen/local-llm";

export interface ModelProgressCardProps {
  status: LLMEngineStatus;
  progress: number;
  errorMessage: string | null;
  onCancel?: () => void;
  onRetry?: () => void;
  model?: ModelMetadata | null;
  modelId?: DomainModelId;
}

export interface ProgressCardHeaderProps {
  title: string;
  subtitle: string;
  isError: boolean;
  onCancel?: () => void;
}

export interface ModelNameCardProps {
  displayName: string;
  displayModelId?: DomainModelId;
  quantizeLevel?: string;
}

export interface ModelAttributesSectionProps {
  model: ModelMetadata;
}

export interface ProgressSectionProps {
  percent: number;
  phaseLabel: string;
}

export interface ErrorSectionProps {
  errorMessage: string | null;
}

export interface ActionButtonsProps {
  isInProgress: boolean;
  isError: boolean;
  onCancel?: () => void;
  onRetry?: () => void;
}

export interface AttrRowProps {
  label: string;
  value: string | number;
  delay: number;
}
