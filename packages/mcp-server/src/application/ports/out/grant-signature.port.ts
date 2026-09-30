import type { Result } from "@hexagen/shared";
import type { Grant } from "../../kernel/grant.js";

/**
 * Verifies a caller-supplied Grant was actually issued by this repo's
 * trusted signing key, rather than assembled by the same agent it's meant
 * to limit (docs/kernel/GRANT.md "Enforcement point"). `verify` resolves to
 * `Result<boolean>` rather than throwing on an invalid signature: a bad
 * signature is an ordinary "no" from this port, not a defect in it — only
 * an I/O failure while reaching the trust root (an unreadable key file
 * with the wrong permissions, say) is a `Result` failure.
 */
export interface GrantSignaturePort {
  verify(grant: Grant): Promise<Result<boolean, Error>>;
}
