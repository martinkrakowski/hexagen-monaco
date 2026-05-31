export interface GitHubUser {
  readonly id: number;
  readonly login: string;
  readonly name: string;
  readonly email: string;
  readonly avatarUrl?: string;
  readonly company?: string;
}
