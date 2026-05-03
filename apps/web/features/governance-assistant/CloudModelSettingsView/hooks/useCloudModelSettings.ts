import { useReducer, useCallback } from "react";
import type { CloudSettings } from "../types";

interface CloudFormState {
  selectedProvider: string;
  selectedModel: string;
  apiKey: string;
  rememberKey: boolean;
  isStoring: boolean;
}

type CloudFormAction =
  | { type: "SET_PROVIDER"; payload: string }
  | { type: "SET_MODEL"; payload: string }
  | { type: "SET_API_KEY"; payload: string }
  | { type: "SET_REMEMBER_KEY"; payload: boolean }
  | { type: "SET_STORING"; payload: boolean }
  | { type: "RESET_FORM" };

const initialState: CloudFormState = {
  selectedProvider: "",
  selectedModel: "",
  apiKey: "",
  rememberKey: false,
  isStoring: false,
};

function cloudFormReducer(
  state: CloudFormState,
  action: CloudFormAction,
): CloudFormState {
  switch (action.type) {
    case "SET_PROVIDER":
      return { ...state, selectedProvider: action.payload, selectedModel: "" };
    case "SET_MODEL":
      return { ...state, selectedModel: action.payload };
    case "SET_API_KEY":
      return { ...state, apiKey: action.payload };
    case "SET_REMEMBER_KEY":
      return { ...state, rememberKey: action.payload };
    case "SET_STORING":
      return { ...state, isStoring: action.payload };
    case "RESET_FORM":
      return {
        ...initialState,
        selectedProvider: state.selectedProvider,
        selectedModel: state.selectedModel,
      };
    default:
      return state;
  }
}

export function useCloudModelSettings() {
  const [state, dispatch] = useReducer(cloudFormReducer, initialState);

  const setProvider = useCallback((provider: string) => {
    dispatch({ type: "SET_PROVIDER", payload: provider });
  }, []);

  const setModel = useCallback((model: string) => {
    dispatch({ type: "SET_MODEL", payload: model });
  }, []);

  const setApiKey = useCallback((apiKey: string) => {
    dispatch({ type: "SET_API_KEY", payload: apiKey });
  }, []);

  const setRememberKey = useCallback((remember: boolean) => {
    dispatch({ type: "SET_REMEMBER_KEY", payload: remember });
  }, []);

  const setStoring = useCallback((storing: boolean) => {
    dispatch({ type: "SET_STORING", payload: storing });
  }, []);

  const resetForm = useCallback(() => {
    dispatch({ type: "RESET_FORM" });
  }, []);

  const getSettings = useCallback((): CloudSettings => {
    return {
      email: "",
      apiKey: state.apiKey,
      modelId: state.selectedModel,
      providerId: state.selectedProvider,
      temperature: 0.7,
      maxTokens: 2000,
    };
  }, [state.apiKey, state.selectedModel, state.selectedProvider]);

  return {
    state,
    setProvider,
    setModel,
    setApiKey,
    setRememberKey,
    setStoring,
    resetForm,
    getSettings,
  };
}
