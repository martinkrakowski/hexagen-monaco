import { z } from 'zod';

// WizardStep — Value Object (enum + helper)
export enum WizardStep {
  Basics = 'basics',
  DomainModeling = 'domain-modeling',
  Infrastructure = 'infrastructure',
  AddOns = 'addons',
  Review = 'review',
  Generate = 'generate',
  Complete = 'complete',
}

export const WizardStepSchema = z.nativeEnum(WizardStep);

// WizardIntent — Discriminated Union
export type WizardIntent =
  | {
      type: 'START_WIZARD';
      payload: { initialConfig?: Partial<ProjectConfig> };
    }
  | {
      type: 'UPDATE_FIELD';
      payload: { field: keyof ProjectConfig; value: unknown };
    }
  | { type: 'NEXT_STEP'; payload?: { skipValidation?: boolean } }
  | { type: 'PREVIOUS_STEP' }
  | { type: 'RESET_WIZARD'; payload?: { preserveBasics?: boolean } }
  | { type: 'CONFIRM_DESTRUCTIVE_ACTION'; payload: { action: string } }
  | {
      type: 'APPLY_AGENT_SUGGESTION';
      payload: { suggestionId: string; patch: unknown };
    }
  | { type: 'VALIDATION_FAILED'; payload: { errors: Record<string, string[]> } }
  | { type: 'GENERATION_STARTED' }
  | {
      type: 'GENERATION_COMPLETED';
      payload: { generatedProject: GeneratedProject };
    }
  | { type: 'GENERATION_FAILED'; payload: { error: Error } }; // temporary Error, will use domain error

// WizardSession — Aggregate Root (immutable state)
export interface WizardSession {
  readonly step: WizardStep;
  readonly config: ProjectConfig;
  readonly validationErrors: Record<string, string[]>;
  readonly isGenerating: boolean;
  readonly generatedProject?: GeneratedProject;
  readonly lastIntent?: WizardIntent;
  readonly undoStack: WizardSession[]; // limited depth undo
}

export type ProjectConfig = {
  projectName: string;
  description?: string;
  boundedContexts: string[];
  // ... other fields will be added later from project-configuration
};

export type GeneratedProject = {
  manifest: string;
  fileTree: unknown;
  // full shape defined later in project-generation
};

// Factory for initial state
export function createInitialWizardSession(
  initialConfig: Partial<ProjectConfig> = {}
): WizardSession {
  return {
    step: WizardStep.Basics,
    config: {
      projectName: initialConfig.projectName || 'new-project',
      description: initialConfig.description || '',
      boundedContexts: initialConfig.boundedContexts || [],
    },
    validationErrors: {},
    isGenerating: false,
    undoStack: [],
  };
}

// Pure reducer (core domain logic — temporary inline version)
export function reduceWizardSession(
  state: WizardSession,
  intent: WizardIntent
): WizardSession {
  const newUndoStack = [...state.undoStack, state].slice(-10);

  switch (intent.type) {
    case 'START_WIZARD':
      return {
        ...createInitialWizardSession(intent.payload.initialConfig),
        undoStack: newUndoStack,
      };

    case 'UPDATE_FIELD': {
      const { field, value } = intent.payload;
      return {
        ...state,
        config: { ...state.config, [field]: value },
        validationErrors: { ...state.validationErrors, [field]: [] },
        undoStack: newUndoStack,
      };
    }

    case 'NEXT_STEP': {
      const steps = Object.values(WizardStep);
      const currentIndex = steps.indexOf(state.step);
      if (currentIndex === -1 || currentIndex >= steps.length - 1) {
        return state;
      }
      return {
        ...state,
        step: steps[currentIndex + 1] as WizardStep,
        undoStack: newUndoStack,
      };
    }

    case 'PREVIOUS_STEP': {
      const steps = Object.values(WizardStep);
      const currentIndex = steps.indexOf(state.step);
      if (currentIndex <= 0) return state;
      return {
        ...state,
        step: steps[currentIndex - 1] as WizardStep,
        undoStack: newUndoStack,
      };
    }

    default:
      return state;
  }
}

// Local domain errors (temporary — will move to src/domain/errors.ts later)
export class WizardDomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'WizardDomainError';
  }
}

// Helper to check if current step is valid for progression
export function canProceedFromStep(session: WizardSession): boolean {
  // Placeholder — real validation later in ValidateStep use-case
  return (
    session.validationErrors[session.step] === undefined ||
    session.validationErrors[session.step].length === 0
  );
}
