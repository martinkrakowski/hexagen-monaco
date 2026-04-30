export type { Result } from "@hexagen/shared";
export { ok, err } from "@hexagen/shared";

export type { ByokError } from "./errors/byok-error.vo.js";
export type {
  ByokProvider,
  AAD,
  CiphertextEnvelope,
  KeyVersion,
} from "./value-objects/index.js";
export {
  BYOK_PROVIDERS,
  isByokProvider,
  constructAAD,
  aadToBuffer,
  isKeyVersionStale,
} from "./value-objects/index.js";
export type { KeyMetadata, EncryptedKey } from "./entities/index.js";
export { validateApiKeyFormat } from "./services/index.js";
