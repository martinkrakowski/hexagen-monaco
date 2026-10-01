import type { GrantSignaturePort } from "../ports/out/grant-signature.port.js";
import type { Grant, GrantDenialCode } from "./grant.js";

export type SignatureCheck =
  | { readonly allowed: true; readonly grant: Grant }
  | {
      readonly allowed: false;
      readonly reason: string;
      readonly code: GrantDenialCode;
    };

/**
 * The provenance check: a grant must be present and carry a signature that
 * verifies against the trusted issuer; a self-asserted grant is never
 * trusted. On success it returns the narrowed grant. Window and revocation
 * are `checkGrantWindow` in `./grant.ts`. This runs before any scope check
 * (`checkMutationAgainstGrant`, `checkWriteAgainstGrant`), which are
 * scope-only and trust nothing on their own.
 */
export async function checkGrantSignature(
  grant: Grant | undefined,
  signaturePort: GrantSignaturePort,
): Promise<SignatureCheck> {
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
  return { allowed: true, grant };
}
