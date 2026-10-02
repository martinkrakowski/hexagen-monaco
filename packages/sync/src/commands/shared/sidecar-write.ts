// The writers live in @hexagen/shared so the MCP server stores proposals with
// the very same temp-then-link code (never a second copy).
export {
  SidecarFileExistsError,
  writeFileExclusive,
  writeFileReplace,
} from "@hexagen/shared/node/sidecar-write";
