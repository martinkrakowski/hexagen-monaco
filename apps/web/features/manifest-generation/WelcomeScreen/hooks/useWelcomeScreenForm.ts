import { useState } from "react";

const MIN_LENGTH = 10;
const MAX_LENGTH = 2000;

export interface FormState {
  description: string;
  platform: string;
  deployment: string;
  selectedExample: number | null;
}

export interface FormHandlers {
  setValue: (key: keyof FormState, value: string | number | null) => void;
  reset: () => void;
  charCount: number;
  isValid: boolean;
}

const initialState: FormState = {
  description: "",
  platform: "",
  deployment: "",
  selectedExample: null,
};

export function useWelcomeScreenForm(): [FormState, FormHandlers] {
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
  const isValid = charCount >= MIN_LENGTH && charCount <= MAX_LENGTH;

  return [
    formState,
    {
      setValue,
      reset,
      charCount,
      isValid,
    },
  ];
}
