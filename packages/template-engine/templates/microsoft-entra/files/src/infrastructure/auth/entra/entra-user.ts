export interface EntraUser {
  readonly oid: string;
  readonly upn: string;
  readonly displayName: string;
  readonly email: string;
  readonly groups: ReadonlyArray<string>;
  readonly roles: ReadonlyArray<string>;
  readonly avatarUrl?: string;
}
