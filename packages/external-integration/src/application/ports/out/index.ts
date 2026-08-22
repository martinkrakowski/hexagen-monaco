// version-control-system.port.js now exports only PullRequestMetadata (a live
// cross-package type). The dead auth driven ports (OAuthProviderPort,
// SessionReadPort) were removed with the auth hexagon (AUD-008).
export * from "./version-control-system.port.js";
export * from "./repository-writer.port.js";
// BF-6.3: the pull-request write surface. Carries runtime exports (the kill
// switch constant + predicate) as well as its types, so routes can ask the
// same default-off question the adapter asks.
export * from "./pull-request-opener.port.js";
