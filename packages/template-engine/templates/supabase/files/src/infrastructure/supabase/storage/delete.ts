import { createSupabaseServerClient } from "../server";
import { ok, err, StorageError, type Result } from "../result";

// Delete one or more files from a bucket.
export async function deleteFile(
  bucket: string,
  paths: string[],
): Promise<Result<void, StorageError>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.storage.from(bucket).remove(paths);
    if (error) return err(new StorageError(error.message, error));
    return ok(undefined);
  } catch (cause) {
    return err(new StorageError("Delete failed", cause));
  }
}
