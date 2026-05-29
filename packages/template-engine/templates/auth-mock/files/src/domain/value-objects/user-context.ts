export interface UserContext {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly roles: ReadonlyArray<string>;
  readonly avatarUrl?: string;
}

export function hasRole(user: UserContext, role: string): boolean {
  return user.roles.includes(role);
}
