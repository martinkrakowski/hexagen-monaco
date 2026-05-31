// @hexagen-server-only
import type {
  FireflyStoragePort,
  PresignedHref,
} from "../../../domain/ports/out/firefly-storage.port";

/**
 * Default storage presigner — storage_mode={storage_mode}.
 *
 * `passthrough` assumes the caller already supplies presigned hrefs and returns
 * them unchanged (zero dependencies). When storage_mode=addon, an
 * `adobe-firefly-storage-*` addon calls `setStoragePresigner()` at startup to
 * register a real S3/GCS/Azure presigner. Service adapters resolve the active
 * presigner via `getStoragePresigner()`, so the core never imports a cloud SDK
 * and no gated file is statically referenced.
 */
export class PassthroughStorageAdapter implements FireflyStoragePort {
  async presignInput(ref: string): Promise<PresignedHref> {
    return { href: ref };
  }
  async presignOutput(ref: string): Promise<PresignedHref> {
    return { href: ref };
  }
}

let active: FireflyStoragePort = new PassthroughStorageAdapter();

/** Register a real presigner (called by an `adobe-firefly-storage-*` addon). */
export function setStoragePresigner(presigner: FireflyStoragePort): void {
  active = presigner;
}

/** Resolve the active presigner — passthrough unless an addon registered one. */
export function getStoragePresigner(): FireflyStoragePort {
  return active;
}
