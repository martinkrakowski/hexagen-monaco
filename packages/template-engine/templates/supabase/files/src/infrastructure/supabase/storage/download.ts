import { createSupabaseServerClient } from "../server";
import { ok, err, StorageError, type Result } from "../result";

// Download a file as a Blob. Use .arrayBuffer() / .text() on the result as needed.
export async function downloadFile(
  bucket: string,
  path: string,
): Promise<Result<Blob, StorageError>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error) return err(new StorageError(error.message, error));
    return ok(data);
  } catch (cause) {
    return err(new StorageError("Download failed", cause));
  }
}
