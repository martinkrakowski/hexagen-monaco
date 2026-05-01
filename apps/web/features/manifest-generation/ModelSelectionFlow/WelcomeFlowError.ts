export type WelcomeFlowErrorCode =
  | "network_failure"
  | "model_corrupted"
  | "webgpu_unavailable"
  | "key_invalid_format"
  | "key_rejected"
  | "inference_timeout"
  | "inference_failed"
  | "no_yaml_extracted";

export const WELCOME_FLOW_ERROR_MESSAGES: Record<WelcomeFlowErrorCode, string> =
  {
    network_failure:
      "Network connection failed. Please check your internet connection and try again.",
    model_corrupted:
      "The model cache appears to be corrupted. You can repair the download using the option below.",
    webgpu_unavailable:
      "Your browser does not support WebGPU, which is required for running local AI models. Please use Chrome 113+, Edge 113+, or switch to a cloud model.",
    key_invalid_format:
      "The API key format appears invalid. Please check your key and try again.",
    key_rejected:
      "The API key was rejected by the provider. Please verify your key is active and has sufficient quota.",
    inference_timeout:
      "The AI model took too long to respond. Please try again with a shorter description or switch models.",
    inference_failed:
      "The AI model failed to generate a response. Please try again or switch to a different model.",
    no_yaml_extracted:
      "The AI response did not contain a valid manifest YAML block. Please refine your project description and try again.",
  };
