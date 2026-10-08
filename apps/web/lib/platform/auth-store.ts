import type { PlatformDb } from "./db";
import type { Adapter, AdapterUser, AdapterAccount } from "next-auth/adapters";

interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
  email_verified: string | null;
  image: string | null;
}

interface SessionRow {
  session_token: string;
  user_id: string;
  expires: string;
}

interface VerificationRow {
  identifier: string;
  token: string;
  expires: string;
}

function toAdapterUser(row: UserRow): AdapterUser {
  return {
    id: row.id,
    name: row.name ?? undefined,
    email: row.email ?? "",
    emailVerified: row.email_verified ? new Date(row.email_verified) : null,
    image: row.image ?? undefined,
  };
}

/** GitHub logins are case-insensitive; store and look up one canonical form. */
function canonicalizeGithubLogin(login: string): string {
  return login.trim().toLowerCase();
}

export interface AuthRepository {
  createUser(user: Omit<AdapterUser, "id">): Promise<AdapterUser>;
  getUser(id: string): Promise<AdapterUser | null>;
  getUserByEmail(email: string): Promise<AdapterUser | null>;
  getUserByAccount(
    provider: string,
    providerAccountId: string,
  ): Promise<AdapterUser | null>;
  updateUser(
    user: Partial<AdapterUser> & Pick<AdapterUser, "id">,
  ): Promise<AdapterUser>;
  /**
   * P-A1: persist the GitHub username seen in the OAuth profile.
   *
   * All siblings here are async now (D-A9) for parity with the coming driver
   * migration, so this is written in the same form.
   *
   * Idempotent: re-running a sign-in with the same profile is a no-op.
   */
  setGithubLogin(userId: string, login: string): Promise<void>;
  getUserByGithubLogin(login: string): Promise<AdapterUser | null>;
  /**
   * P-U0b: when this user completed (or skipped — D-U4) onboarding.
   *
   * NULL means "never" — the state every user starts in, including everyone
   * who predates the column. Unknown user ids also read as NULL: the caller
   * holds a JWT `sub`, and "no row" and "not onboarded" demand the same
   * response.
   */
  getOnboardedAt(userId: string): Promise<string | null>;
  /**
   * Stamp onboarding complete — once.
   *
   * Idempotent BY THE STATEMENT, not by a read-first: the UPDATE's
   * `AND onboarded_at IS NULL` clause makes a second call a no-op, so the
   * original timestamp survives replays (a wizard "Done" double-click, a
   * refreshed final step). A SELECT-then-UPDATE would race two concurrent
   * completions into two different timestamps, the later one winning.
   */
  markOnboarded(userId: string): Promise<void>;
  linkAccount(account: AdapterAccount): Promise<void>;
  unlinkAccount(provider: string, providerAccountId: string): Promise<void>;
  createSession(session: {
    sessionToken: string;
    userId: string;
    expires: Date;
  }): Promise<{ sessionToken: string; userId: string; expires: Date }>;
  getSessionAndUser(sessionToken: string): Promise<{
    session: { sessionToken: string; userId: string; expires: Date };
    user: AdapterUser;
  } | null>;
  updateSession(session: {
    sessionToken: string;
    userId?: string;
    expires?: Date;
  }): Promise<{ sessionToken: string; userId: string; expires: Date } | null>;
  deleteSession(sessionToken: string): Promise<void>;
  createVerificationToken(token: {
    identifier: string;
    token: string;
    expires: Date;
  }): Promise<{ identifier: string; token: string; expires: Date }>;
  useVerificationToken(params: {
    identifier: string;
    token: string;
  }): Promise<{ identifier: string; token: string; expires: Date } | null>;
}

export function createAuthRepository(db: PlatformDb): AuthRepository {
  const insertUser = `
    INSERT INTO users (id, name, email, email_verified, image, created_at)
    VALUES (@id, @name, @email, @email_verified, @image, @created_at)
  `;
  const selectUser = "SELECT * FROM users WHERE id = ?";
  const selectUserByEmail = "SELECT * FROM users WHERE email = ?";
  const selectUserByAccount = `
    SELECT u.* FROM users u
      INNER JOIN accounts a ON a.user_id = u.id
     WHERE a.provider = ? AND a.provider_account_id = ?
  `;
  const updateUser = `
    UPDATE users
       SET name = COALESCE(@name, name),
           email = COALESCE(@email, email),
           email_verified = COALESCE(@email_verified, email_verified),
           image = COALESCE(@image, image)
      WHERE id = @id
  `;
  const setGithubLogin =
    "UPDATE users SET github_login = @github_login WHERE id = @id";
  const selectUserByGithubLogin =
    "SELECT * FROM users WHERE github_login = ?";
  const selectOnboardedAt =
    "SELECT onboarded_at FROM users WHERE id = ?";
  const markOnboarded = `
    UPDATE users
        SET onboarded_at = @onboarded_at
      WHERE id = @id AND onboarded_at IS NULL
  `;
  const insertAccount = `
    INSERT INTO accounts (provider, provider_account_id, user_id, type)
    VALUES (@provider, @provider_account_id, @user_id, @type)
    ON CONFLICT(provider, provider_account_id) DO UPDATE SET
      user_id = excluded.user_id,
      type = excluded.type
  `;
  const deleteAccount =
    "DELETE FROM accounts WHERE provider = ? AND provider_account_id = ?";
  const insertSession = `
    INSERT INTO sessions (session_token, user_id, expires)
    VALUES (@session_token, @user_id, @expires)
  `;
  const selectSession =
    "SELECT * FROM sessions WHERE session_token = ?";
  const updateSession = `
    UPDATE sessions
       SET user_id = COALESCE(@user_id, user_id),
           expires = COALESCE(@expires, expires)
     WHERE session_token = @session_token
  `;
  const deleteSession =
    "DELETE FROM sessions WHERE session_token = ?";
  const insertVerification = `
    INSERT INTO verification_tokens (identifier, token, expires)
    VALUES (@identifier, @token, @expires)
  `;
  const takeVerification = `
    DELETE FROM verification_tokens
     WHERE identifier = ? AND token = ?
    RETURNING identifier, token, expires
  `;

  return {
    async createUser(user) {
      const id = crypto.randomUUID();
      await db.run(insertUser, {
        id,
        name: user.name ?? null,
        email: user.email ?? null,
        email_verified: user.emailVerified
          ? user.emailVerified.toISOString()
          : null,
        image: user.image ?? null,
        created_at: new Date().toISOString(),
      });
      const row = (await db.get<UserRow>(selectUser, [id]))!;
      return toAdapterUser(row);
    },
    async getUser(id) {
      const row = await db.get<UserRow | undefined>(selectUser, [id]);
      return row ? toAdapterUser(row) : null;
    },
    async getUserByEmail(email) {
      if (!email) return null;
      const row = await db.get<UserRow | undefined>(selectUserByEmail, [
        email,
      ]);
      return row ? toAdapterUser(row) : null;
    },
    async getUserByAccount(provider, providerAccountId) {
      const row = await db.get<UserRow | undefined>(selectUserByAccount, [
        provider,
        providerAccountId,
      ]);
      return row ? toAdapterUser(row) : null;
    },
    async updateUser(user) {
      await db.run(updateUser, {
        id: user.id,
        name: user.name ?? null,
        email: user.email ?? null,
        email_verified: user.emailVerified
          ? user.emailVerified.toISOString()
          : null,
        image: user.image ?? null,
      });
      const row = await db.get<UserRow | undefined>(selectUser, [user.id]);
      if (!row) {
        throw new Error(`User ${user.id} not found`);
      }
      return toAdapterUser(row);
    },
    async setGithubLogin(userId, login) {
      const canonical = canonicalizeGithubLogin(login);
      if (!canonical) return;
      await db.run(setGithubLogin, { id: userId, github_login: canonical });
    },
    async getUserByGithubLogin(login) {
      const canonical = canonicalizeGithubLogin(login);
      if (!canonical) return null;
      const row = await db.get<UserRow | undefined>(selectUserByGithubLogin, [
        canonical,
      ]);
      return row ? toAdapterUser(row) : null;
    },
    async getOnboardedAt(userId) {
      const row = await db.get<{ onboarded_at: string | null }>(
        selectOnboardedAt,
        [userId],
      );
      return row?.onboarded_at ?? null;
    },
    async markOnboarded(userId) {
      await db.run(markOnboarded, {
        id: userId,
        onboarded_at: new Date().toISOString(),
      });
    },
    async linkAccount(account) {
      await db.run(insertAccount, {
        provider: account.provider,
        provider_account_id: account.providerAccountId,
        user_id: account.userId,
        type: account.type,
      });
    },
    async unlinkAccount(provider, providerAccountId) {
      await db.run(deleteAccount, [provider, providerAccountId]);
    },
    async createSession(session) {
      await db.run(insertSession, {
        session_token: session.sessionToken,
        user_id: session.userId,
        expires: session.expires.toISOString(),
      });
      return session;
    },
    async getSessionAndUser(sessionToken) {
      const session = await db.get<SessionRow | undefined>(selectSession, [
        sessionToken,
      ]);
      if (!session) return null;
      const user = await db.get<UserRow | undefined>(selectUser, [
        session.user_id,
      ]);
      if (!user) return null;
      return {
        session: {
          sessionToken: session.session_token,
          userId: session.user_id,
          expires: new Date(session.expires),
        },
        user: toAdapterUser(user),
      };
    },
    async updateSession(session) {
      await db.run(updateSession, {
        session_token: session.sessionToken,
        user_id: session.userId ?? null,
        expires: session.expires ? session.expires.toISOString() : null,
      });
      const row = await db.get<SessionRow | undefined>(selectSession, [
        session.sessionToken,
      ]);
      if (!row) return null;
      return {
        sessionToken: row.session_token,
        userId: row.user_id,
        expires: new Date(row.expires),
      };
    },
    async deleteSession(sessionToken) {
      await db.run(deleteSession, [sessionToken]);
    },
    async createVerificationToken(token) {
      await db.run(insertVerification, {
        identifier: token.identifier,
        token: token.token,
        expires: token.expires.toISOString(),
      });
      return token;
    },
    async useVerificationToken(params) {
      const row = await db.get<VerificationRow | undefined>(
        takeVerification,
        [params.identifier, params.token],
      );
      if (!row) return null;
      return {
        identifier: row.identifier,
        token: row.token,
        expires: new Date(row.expires),
      };
    },
  };
}

export function createNextAuthAdapter(
  auth: AuthRepository | (() => AuthRepository),
): Adapter {
  const resolve = typeof auth === "function" ? auth : () => auth;
  return {
    createUser: (user: Omit<AdapterUser, "id">) => resolve().createUser(user),
    getUser: (id: string) => resolve().getUser(id),
    getUserByEmail: (email: string) => resolve().getUserByEmail(email),
    getUserByAccount: ({
      provider,
      providerAccountId,
    }: Pick<AdapterAccount, "provider" | "providerAccountId">) =>
      resolve().getUserByAccount(provider, providerAccountId),
    updateUser: (user: Partial<AdapterUser> & Pick<AdapterUser, "id">) =>
      resolve().updateUser(user),
    linkAccount: async (account: AdapterAccount) => {
      await resolve().linkAccount(account);
    },
    unlinkAccount: async ({
      provider,
      providerAccountId,
    }: Pick<AdapterAccount, "provider" | "providerAccountId">) => {
      await resolve().unlinkAccount(provider, providerAccountId);
    },
    createSession: (session: {
      sessionToken: string;
      userId: string;
      expires: Date;
    }) => resolve().createSession(session),
    getSessionAndUser: (sessionToken: string) =>
      resolve().getSessionAndUser(sessionToken),
    updateSession: (
      session: Partial<{
        sessionToken: string;
        userId: string;
        expires: Date;
      }> & { sessionToken: string },
    ) => resolve().updateSession(session),
    deleteSession: async (sessionToken: string) => {
      await resolve().deleteSession(sessionToken);
    },
    createVerificationToken: (token: {
      identifier: string;
      token: string;
      expires: Date;
    }) => resolve().createVerificationToken(token),
    useVerificationToken: (params: { identifier: string; token: string }) =>
      resolve().useVerificationToken(params),
  };
}
