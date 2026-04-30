export type { ByokProvider } from "./provider.vo.js";
export { BYOK_PROVIDERS, isByokProvider } from "./provider.vo.js";

export type { CiphertextEnvelope } from "./ciphertext-envelope.vo.js";

export type { KeyVersion } from "./key-version.vo.js";
export { isKeyVersionStale } from "./key-version.vo.js";

export type { AAD } from "./aad.vo.js";
export { constructAAD, aadToBuffer } from "./aad.vo.js";
