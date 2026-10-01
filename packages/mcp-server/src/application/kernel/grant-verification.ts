import type { GrantSignaturePort } from "../ports/out/grant-signature.port.js";
import type { Grant, GrantCheck } from "./grant.js";

/**
 * The provenance check shared by every enforcement path (the monaco accept
 * choke point and the client write adapter): a grant must be present and
 * carry a signature that verifies against the trusted issuer. A
 * self-asserted grant is never trusted, whatever fields it claims. Window
 * (expiry) and revocation are `checkGrantWindow` in `./grant.ts`.
 */
export async function checkGrantSignature(
  grant: Grant | undefined,
  signaturePort: GrantSignaturePort,
): Promise<GrantCheck> {
  if (!grant) {
    return {
      allowed: false,
      code: "grant_denied",
      reason: "No Grant supplied; refusing to accept",
    };
  }

  const signatureResult = await signaturePort.verify(grant);
  if (!signatureResult.success) {
    return {
      allowed: false,
      code: "grant_denied",
      reason: `Grant '${grant.id}' signature could not be verified: ${signatureResult.error.message}`,
    };
  }
  if (!signatureResult.value) {
    return {
      allowed: false,
      code: "grant_denied",
      reason: `Grant '${grant.id}' has no valid signature from a trusted issuer; refusing to trust a self-asserted grant`,
    };
  }
  return { allowed: true };
}
