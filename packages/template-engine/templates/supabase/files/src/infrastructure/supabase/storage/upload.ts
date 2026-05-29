import { createSupabaseServerClient } from "../server";
import { ok, err, StorageError, type Result } from "../result";

// Upload a file and return its storage path. Pass upsert to overwrite.
export async function uploadFile(
  bucket: string,
  path: string,
  file: File | ArrayBuffer | Buffer,
  options?: { contentType?: string; upsert?: boolean },
): Promise<Result<{ path: string }, StorageError>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(path, file, {
        contentType: options?.contentType,
        upsert: options?.upsert ?? false,
      });
    if (error) return err(new StorageError(error.message, error));
    return ok({ path: data.path });
  } catch (cause) {
    return err(new StorageError("Upload failed", cause));
  }
}
