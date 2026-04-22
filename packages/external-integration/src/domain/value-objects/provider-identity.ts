export interface ProviderIdentity {
  login: string;
  displayName: string;
  avatarUrl: string;
}

export function createProviderIdentity(
  login: string,
  displayName: string,
  avatarUrl: string = "",
): ProviderIdentity {
  return {
    login,
    displayName,
    avatarUrl: avatarUrl || `https://github.com/${login}.png`,
  };
}
