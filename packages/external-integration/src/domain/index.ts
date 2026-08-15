// The external-integration domain layer is intentionally empty. Its former
// value objects (AuthSession, ProviderIdentity, GitHubProvider) belonged to a
// dead auth hexagon (AUD-008) with zero adapters and zero consumers; real
// GitHub auth is NextAuth in apps/web (ADR-0046). The package's live surface is
// infrastructure-only (scaffold export + editor push) plus the RepositoryWriter
// port it depends on.
export {};
