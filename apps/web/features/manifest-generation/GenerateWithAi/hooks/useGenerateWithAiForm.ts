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
  loadedFileName: string | null;
}

export interface FormHandlers {
  setValue: (key: keyof FormState, value: string | number | null) => void;
  reset: () => void;
  loadFromFile: (content: string, filename: string) => void;
  clearFile: () => void;
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
  loadedFileName: null,
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

  const loadFromFile = (content: string, filename: string) => {
    setFormState((prev) => ({
      ...prev,
      description: content.slice(0, DESCRIPTION_MAX_LENGTH),
      loadedFileName: filename,
      selectedExample: null,
    }));
  };

  const clearFile = () => {
    setFormState((prev) => ({
      ...prev,
      description: "",
      loadedFileName: null,
    }));
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
      loadFromFile,
      clearFile,
      charCount,
      isValid,
      isTooShort,
      isTooLong,
    },
  ];
}
