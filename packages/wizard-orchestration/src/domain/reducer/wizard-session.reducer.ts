import type {
  WizardSession,
  WizardIntent,
  ProjectConfig,
  // GeneratedProject,
} from '../model/wizard-session/wizard-session';
import { WizardStep } from '../model/wizard-session/wizard-session';
import { WizardDomainError } from '../model/wizard-session/wizard-session'; // temporary local error

/**
 * Pure reducer: takes current immutable session + intent → new immutable session
 * All business rules for state transitions live here.
 * No side effects, no I/O, no framework dependencies.
 */
export function reduceWizardSession(
  state: WizardSession,
  intent: WizardIntent
): WizardSession {
  // Create limited undo stack (max 10 steps)
  const newUndoStack = [...state.undoStack, state].slice(-10);

  switch (intent.type) {
    case 'START_WIZARD': {
      const initialConfig = intent.payload.initialConfig ?? {};
      return {
        ...createInitialSession(initialConfig),
        undoStack: newUndoStack,
      };
    }

    case 'UPDATE_FIELD': {
      const { field, value } = intent.payload;
      // Basic invariant: prevent invalid field updates (expand later)
      if (!(field in state.config)) {
        throw new WizardDomainError(
          `Invalid field update: ${String(field)} does not exist in ProjectConfig`,
          'INVALID_FIELD',
          { attemptedField: field }
        );
      }

      return {
        ...state,
        config: { ...state.config, [field]: value },
        validationErrors: { ...state.validationErrors, [field]: [] },
        undoStack: newUndoStack,
        lastIntent: intent,
      };
    }

    case 'NEXT_STEP': {
      const steps = Object.values(WizardStep);
      const currentIndex = steps.indexOf(state.step);

      if (currentIndex === -1) {
        throw new WizardDomainError(
          'Current step not found in enum',
          'INVALID_STATE'
        );
      }

      if (currentIndex >= steps.length - 1) {
        // Already at last step — no-op or throw depending on policy
        return state;
      }

      // Optional skip validation (for agent overrides)
      if (!intent.payload?.skipValidation && !canProceedFromStep(state)) {
        throw new WizardDomainError(
          `Cannot proceed from ${state.step}: validation errors present`,
          'VALIDATION_BLOCKED',
          { errors: state.validationErrors }
        );
      }

      return {
        ...state,
        step: steps[currentIndex + 1] as WizardStep,
        undoStack: newUndoStack,
        lastIntent: intent,
      };
    }

    case 'PREVIOUS_STEP': {
      const steps = Object.values(WizardStep);
      const currentIndex = steps.indexOf(state.step);

      if (currentIndex <= 0) {
        return state; // Can't go before first step
      }

      return {
        ...state,
        step: steps[currentIndex - 1] as WizardStep,
        undoStack: newUndoStack,
        lastIntent: intent,
      };
    }

    case 'RESET_WIZARD': {
      const preserveBasics = intent.payload?.preserveBasics ?? false;
      const initial = createInitialSession(
        preserveBasics
          ? {
              projectName: state.config.projectName,
              description: state.config.description,
            }
          : {}
      );
      return {
        ...initial,
        undoStack: newUndoStack,
        lastIntent: intent,
      };
    }

    case 'VALIDATION_FAILED': {
      return {
        ...state,
        validationErrors: intent.payload.errors,
        lastIntent: intent,
      };
    }

    case 'GENERATION_STARTED': {
      return {
        ...state,
        isGenerating: true,
        lastIntent: intent,
      };
    }

    case 'GENERATION_COMPLETED': {
      return {
        ...state,
        isGenerating: false,
        generatedProject: intent.payload.generatedProject,
        step: WizardStep.Complete,
        lastIntent: intent,
      };
    }

    case 'GENERATION_FAILED': {
      return {
        ...state,
        isGenerating: false,
        validationErrors: {
          ...state.validationErrors,
          generation: [intent.payload.error.message],
        },
        lastIntent: intent,
      };
    }

    default: {
      // Unknown intent — defensive no-op (or log in future)
      return state;
    }
  }
}

// Private helper — extracted from model for reducer purity
function createInitialSession(
  initialConfig: Partial<ProjectConfig>
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

// Private helper — used in NEXT_STEP validation
function canProceedFromStep(session: WizardSession): boolean {
  const stepErrors = session.validationErrors[session.step];
  return !stepErrors || stepErrors.length === 0;
}
