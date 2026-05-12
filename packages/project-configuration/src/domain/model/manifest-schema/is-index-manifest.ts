export function isIndexManifest(parsed: unknown): boolean {
  if (typeof parsed !== "object" || parsed === null) {
    return false;
  }

  const record = parsed as Record<string, unknown>;

  if (record.version !== "2.0") {
    return false;
  }

  const contexts = record.bounded_contexts;
  if (!Array.isArray(contexts)) {
    return false;
  }

  return contexts.some(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as Record<string, unknown>).file === "string",
  );
}
