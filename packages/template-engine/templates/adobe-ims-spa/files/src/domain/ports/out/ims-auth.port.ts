export interface IMSTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number; // Unix ms
  readonly tokenType: string;
}

export interface IMSUserProfile {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly countryCode?: string;
  readonly avatarUrl?: string;
  readonly account_type?: string;
}

export interface IMSAuthPort {
  exchangeCode(code: string, verifier: string): Promise<IMSTokens>;
  refreshToken(refreshToken: string): Promise<IMSTokens>;
  revokeToken(token: string): Promise<void>;
  fetchProfile(accessToken: string): Promise<IMSUserProfile>;
}
