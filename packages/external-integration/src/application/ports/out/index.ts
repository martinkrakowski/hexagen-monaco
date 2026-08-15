// version-control-system.port.js now exports only PullRequestMetadata (a live
// cross-package type). The dead auth driven ports (OAuthProviderPort,
// SessionReadPort) were removed with the auth hexagon (AUD-008).
export * from "./version-control-system.port.js";
export * from "./repository-writer.port.js";
