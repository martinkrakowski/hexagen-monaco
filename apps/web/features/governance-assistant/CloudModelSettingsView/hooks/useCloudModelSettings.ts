import { useReducer, useCallback, useEffect } from "react";
import type { UserSecretVaultPort } from "@hexagen/web-driver";
import type { CloudSettings } from "../types";

interface CloudFormState {
  selectedProvider: string;
  selectedModel: string;
  apiKey: string;
  rememberKey: boolean;
  isStoring: boolean;
  loadingSettings: boolean;
}

type CloudFormAction =
  | { type: "SET_PROVIDER"; payload: string }
  | { type: "SET_MODEL"; payload: string }
  | { type: "SET_API_KEY"; payload: string }
  | { type: "SET_REMEMBER_KEY"; payload: boolean }
  | { type: "SET_STORING"; payload: boolean }
  | { type: "SET_LOADING_SETTINGS"; payload: boolean }
  | { type: "RESET_FORM" }
  | { type: "LOAD_SETTINGS"; payload: CloudSettings };

const initialState: CloudFormState = {
  selectedProvider: "",
  selectedModel: "",
  apiKey: "",
  rememberKey: false,
  isStoring: false,
  loadingSettings: false,
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
    case "SET_LOADING_SETTINGS":
      return { ...state, loadingSettings: action.payload };
    case "LOAD_SETTINGS":
      return {
        ...state,
        selectedProvider: action.payload.providerId,
        selectedModel: action.payload.modelId,
        apiKey: action.payload.apiKey,
        loadingSettings: false,
      };
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

interface UseCloudModelSettingsProps {
  vault?: UserSecretVaultPort;
}

export function useCloudModelSettings(props?: UseCloudModelSettingsProps) {
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

  /**
   * Load settings from vault on mount
   */
  useEffect(() => {
    const loadSettings = async () => {
      if (!props?.vault) return;

      dispatch({ type: "SET_LOADING_SETTINGS", payload: true });
      try {
        const result = await props.vault.retrieve();
        if (result.success && result.value) {
          // Parse the stored settings (should be JSON string)
          try {
            const settings = JSON.parse(result.value) as CloudSettings;
            dispatch({ type: "LOAD_SETTINGS", payload: settings });
          } catch {
            // If JSON parse fails, just ignore and continue with empty form
            dispatch({ type: "SET_LOADING_SETTINGS", payload: false });
          }
        } else {
          dispatch({ type: "SET_LOADING_SETTINGS", payload: false });
        }
      } catch (error) {
        console.error("[CloudModelSettings] Failed to load settings:", error);
        dispatch({ type: "SET_LOADING_SETTINGS", payload: false });
      }
    };

    loadSettings();
  }, [props?.vault]);

  /**
   * Save settings to vault
   */
  const saveSettings = useCallback(async (): Promise<{
    ok: boolean;
    error?: string;
  }> => {
    if (!props?.vault) {
      return { ok: false, error: "Vault not available" };
    }

    const settings = getSettings();
    try {
      const result = await props.vault.store(
        JSON.stringify(settings),
        state.rememberKey,
      );

      if (result.success) {
        return { ok: true };
      } else {
        const errorMsg =
          result.error?.message || "Failed to save settings to vault";
        return { ok: false, error: errorMsg };
      }
    } catch (error) {
      const errorMsg =
        error instanceof Error
          ? error.message
          : "Unknown error saving settings";
      console.error("[CloudModelSettings] Save error:", errorMsg);
      return { ok: false, error: errorMsg };
    }
  }, [props?.vault, getSettings, state.rememberKey]);

  return {
    state,
    setProvider,
    setModel,
    setApiKey,
    setRememberKey,
    setStoring,
    resetForm,
    getSettings,
    saveSettings,
  };
}
