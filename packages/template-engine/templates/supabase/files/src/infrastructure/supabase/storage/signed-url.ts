import { createSupabaseServerClient } from "../server";
import { ok, err, StorageError, type Result } from "../result";

// Generate a time-limited signed URL. Signed URLs expire — request a fresh one
// rather than caching indefinitely. Defaults to SUPABASE_SIGNED_URL_EXPIRY.
export async function getSignedUrl(
  bucket: string,
  path: string,
  expiresIn?: number,
): Promise<Result<string, StorageError>> {
  // Guard against a blank ("" → 0) or non-numeric env value, which would
  // otherwise expire the URL immediately or produce NaN.
  const parsedTtl = Number(process.env.SUPABASE_SIGNED_URL_EXPIRY);
  const ttl =
    expiresIn ?? (Number.isFinite(parsedTtl) && parsedTtl > 0 ? parsedTtl : 3600);
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, ttl);
    if (error) return err(new StorageError(error.message, error));
    return ok(data.signedUrl);
  } catch (cause) {
    return err(new StorageError("Signed URL generation failed", cause));
  }
}
