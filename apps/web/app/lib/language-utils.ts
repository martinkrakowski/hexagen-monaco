export function getLanguageForFile(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();

  if (filename.toLowerCase() === "dockerfile") return "dockerfile";

  const languageMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    md: "markdown",
    html: "html",
    css: "css",
    yml: "yaml",
    yaml: "yaml",
    sh: "shell",
    xml: "xml",
    sql: "sql",
  };

  return ext && languageMap[ext] ? languageMap[ext] : "plaintext";
}
