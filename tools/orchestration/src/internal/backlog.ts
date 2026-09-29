import { parseArtifact, type PlanVerifyArtifact } from "./artifact.js";

export type BacklogState =
  | { readonly state: "recorded"; readonly artifact: PlanVerifyArtifact }
  | { readonly state: "absent" }
  | { readonly state: "unknown" };

export async function readBacklog(
  readFile: (path: string) => Promise<string>,
  path: string,
): Promise<BacklogState> {
  let text: string;
  try {
    text = await readFile(path);
  } catch (err: unknown) {
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: unknown }).code === "ENOENT"
    ) {
      return { state: "absent" };
    }
    return { state: "unknown" };
  }

  try {
    const artifact = parseArtifact(text);
    return { state: "recorded", artifact };
  } catch {
    return { state: "unknown" };
  }
}
