export interface GoogleUser {
  readonly sub: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name: string;
  readonly picture?: string;
  /** Hosted domain — present only for Google Workspace accounts */
  readonly hd?: string;
}
