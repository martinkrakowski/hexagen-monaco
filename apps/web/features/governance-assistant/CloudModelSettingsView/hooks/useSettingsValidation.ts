import { useState, useCallback } from "react";
import type { ValidationErrors } from "../types";

export interface ValidationState {
  errors: ValidationErrors;
  touched: Record<string, boolean>;
  isDirty: boolean;
}

export function useSettingsValidation(initialDirty: boolean = false) {
  const [state, setState] = useState<ValidationState>({
    errors: {},
    touched: {},
    isDirty: initialDirty,
  });

  const validateEmail = useCallback((email: string): string | undefined => {
    if (!email) return "Email is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return "Invalid email format";
    }
    return undefined;
  }, []);

  const validateApiKey = useCallback((apiKey: string): string | undefined => {
    if (!apiKey || apiKey.trim().length === 0) {
      return "API key is required";
    }
    if (apiKey.length < 5) {
      return "API key appears to be too short";
    }
    return undefined;
  }, []);

  const validateModel = useCallback((modelId: string): string | undefined => {
    if (!modelId) return "Model selection is required";
    return undefined;
  }, []);

  const validateField = useCallback(
    (field: string, value: string): void => {
      let error: string | undefined;
      if (field === "email") error = validateEmail(value);
      else if (field === "apiKey") error = validateApiKey(value);
      else if (field === "model") error = validateModel(value);

      setState((prev) => ({
        ...prev,
        errors: { ...prev.errors, [field]: error },
        touched: { ...prev.touched, [field]: true },
      }));
    },
    [validateEmail, validateApiKey, validateModel],
  );

  const markFieldTouched = useCallback((field: string) => {
    setState((prev) => ({
      ...prev,
      touched: { ...prev.touched, [field]: true },
    }));
  }, []);

  const clearErrors = useCallback(() => {
    setState((prev) => ({
      ...prev,
      errors: {},
      touched: {},
      isDirty: false,
    }));
  }, []);

  const setDirty = useCallback((dirty: boolean) => {
    setState((prev) => ({
      ...prev,
      isDirty: dirty,
    }));
  }, []);

  const hasErrors = useCallback((): boolean => {
    return Object.keys(state.errors).length > 0;
  }, [state.errors]);

  return {
    ...state,
    validateField,
    markFieldTouched,
    clearErrors,
    setDirty,
    hasErrors,
  };
}
