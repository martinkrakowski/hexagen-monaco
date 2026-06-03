import { useState } from "react";
import {
  DEFAULT_MAX_BOUNDED_CONTEXTS,
  DESCRIPTION_MIN_LENGTH,
  DESCRIPTION_MAX_LENGTH,
} from "@hexagen/agentic-interaction";

export interface FormState {
  description: string;
  deployment: string;
  maxContexts: number;
  selectedExample: number | null;
}

export interface FormHandlers {
  setValue: (key: keyof FormState, value: string | number | null) => void;
  reset: () => void;
  charCount: number;
  isValid: boolean;
  isTooShort: boolean;
  isTooLong: boolean;
}

const initialState: FormState = {
  description: "",
  deployment: "",
  maxContexts: DEFAULT_MAX_BOUNDED_CONTEXTS,
  selectedExample: null,
};

export function useGenerateWithAiForm(): [FormState, FormHandlers] {
  const [formState, setFormState] = useState<FormState>(initialState);

  const setValue = (key: keyof FormState, value: string | number | null) => {
    setFormState((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const reset = () => {
    setFormState(initialState);
  };

  const charCount = formState.description.length;
  const isValid =
    charCount >= DESCRIPTION_MIN_LENGTH && charCount <= DESCRIPTION_MAX_LENGTH;
  const isTooShort = charCount > 0 && charCount < DESCRIPTION_MIN_LENGTH;
  const isTooLong = charCount > DESCRIPTION_MAX_LENGTH;

  return [
    formState,
    {
      setValue,
      reset,
      charCount,
      isValid,
      isTooShort,
      isTooLong,
    },
  ];
}
