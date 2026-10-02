/**
 * Decoding a proposal for display. The patch is untrusted client source in
 * unknown encoding: it is decoded with a NON-fatal decoder, so a non-UTF-8 patch
 * shows replacement characters (and is labelled) instead of blocking the view.
 */

/** At most this many bytes of one proposal are shown. */
export const PROPOSAL_DISPLAY_CAP_BYTES = 256 * 1024;

export interface DecodedProposal {
  readonly text: string;
  /** The bytes were not valid UTF-8, so the text holds replacement characters. */
  readonly replaced: boolean;
  readonly truncated: boolean;
  readonly totalBytes: number;
  readonly shownBytes: number;
}

const lenient = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });
const strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function decodeProposal(bytes: Uint8Array): DecodedProposal {
  let replaced = false;
  try {
    strict.decode(bytes);
  } catch {
    replaced = true;
  }
  let cut = Math.min(bytes.length, PROPOSAL_DISPLAY_CAP_BYTES);
  // Do not split a multi-byte character at the cap.
  // A UTF-8 character is at most four bytes, so give back at most three.
  if (cut < bytes.length) {
    for (
      let back = 0;
      back < 3 && cut > 0 && ((bytes[cut] as number) & 0xc0) === 0x80;
      back += 1
    ) {
      cut -= 1;
    }
  }
  return {
    text: lenient.decode(bytes.subarray(0, cut)),
    replaced,
    truncated: cut < bytes.length,
    totalBytes: bytes.length,
    shownBytes: cut,
  };
}
