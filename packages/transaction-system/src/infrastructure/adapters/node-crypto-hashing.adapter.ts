import { createHash } from "node:crypto";
import type { HashingPort } from "../../domain/value-objects/transaction-id.js";

/**
 * Infrastructure adapter that implements cryptographic hashing using Node.js crypto module.
 * Implements HashingPort for Node.js runtime.
 */
export class NodeCryptoHashingAdapter implements HashingPort {
  sha256(input: string): string {
    return createHash("sha256").update(input).digest("hex");
  }
}

// Made with Bob
