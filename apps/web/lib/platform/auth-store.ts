import type Database from "better-sqlite3";
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

export interface AuthRepository {
  createUser(user: Omit<AdapterUser, "id">): AdapterUser;
  getUser(id: string): AdapterUser | null;
  getUserByEmail(email: string): AdapterUser | null;
  getUserByAccount(
    provider: string,
    providerAccountId: string,
  ): AdapterUser | null;
  updateUser(user: Partial<AdapterUser> & Pick<AdapterUser, "id">): AdapterUser;
  linkAccount(account: AdapterAccount): void;
  unlinkAccount(provider: string, providerAccountId: string): void;
  createSession(session: {
    sessionToken: string;
    userId: string;
    expires: Date;
  }): { sessionToken: string; userId: string; expires: Date };
  getSessionAndUser(sessionToken: string): {
    session: { sessionToken: string; userId: string; expires: Date };
    user: AdapterUser;
  } | null;
  updateSession(session: {
    sessionToken: string;
    userId?: string;
    expires?: Date;
  }): { sessionToken: string; userId: string; expires: Date } | null;
  deleteSession(sessionToken: string): void;
  createVerificationToken(token: {
    identifier: string;
    token: string;
    expires: Date;
  }): { identifier: string; token: string; expires: Date };
  useVerificationToken(params: {
    identifier: string;
    token: string;
  }): { identifier: string; token: string; expires: Date } | null;
}

export function createAuthRepository(db: Database.Database): AuthRepository {
  const insertUser = db.prepare(`
    INSERT INTO users (id, name, email, email_verified, image, created_at)
    VALUES (@id, @name, @email, @email_verified, @image, @created_at)
  `);
  const selectUser = db.prepare("SELECT * FROM users WHERE id = ?");
  const selectUserByEmail = db.prepare("SELECT * FROM users WHERE email = ?");
  const selectUserByAccount = db.prepare(`
    SELECT u.* FROM users u
      INNER JOIN accounts a ON a.user_id = u.id
     WHERE a.provider = ? AND a.provider_account_id = ?
  `);
  const updateUser = db.prepare(`
    UPDATE users
       SET name = COALESCE(@name, name),
           email = COALESCE(@email, email),
           email_verified = COALESCE(@email_verified, email_verified),
           image = COALESCE(@image, image)
     WHERE id = @id
  `);
  const insertAccount = db.prepare(`
    INSERT INTO accounts (provider, provider_account_id, user_id, type)
    VALUES (@provider, @provider_account_id, @user_id, @type)
    ON CONFLICT(provider, provider_account_id) DO UPDATE SET
      user_id = excluded.user_id,
      type = excluded.type
  `);
  const deleteAccount = db.prepare(
    "DELETE FROM accounts WHERE provider = ? AND provider_account_id = ?",
  );
  const insertSession = db.prepare(`
    INSERT INTO sessions (session_token, user_id, expires)
    VALUES (@session_token, @user_id, @expires)
  `);
  const selectSession = db.prepare(
    "SELECT * FROM sessions WHERE session_token = ?",
  );
  const updateSession = db.prepare(`
    UPDATE sessions
       SET user_id = COALESCE(@user_id, user_id),
           expires = COALESCE(@expires, expires)
     WHERE session_token = @session_token
  `);
  const deleteSession = db.prepare(
    "DELETE FROM sessions WHERE session_token = ?",
  );
  const insertVerification = db.prepare(`
    INSERT INTO verification_tokens (identifier, token, expires)
    VALUES (@identifier, @token, @expires)
  `);
  const takeVerification = db.prepare(`
    DELETE FROM verification_tokens
     WHERE identifier = ? AND token = ?
    RETURNING identifier, token, expires
  `);

  return {
    createUser(user) {
      const id = crypto.randomUUID();
      insertUser.run({
        id,
        name: user.name ?? null,
        email: user.email ?? null,
        email_verified: user.emailVerified
          ? user.emailVerified.toISOString()
          : null,
        image: user.image ?? null,
        created_at: new Date().toISOString(),
      });
      const row = selectUser.get(id) as UserRow;
      return toAdapterUser(row);
    },
    getUser(id) {
      const row = selectUser.get(id) as UserRow | undefined;
      return row ? toAdapterUser(row) : null;
    },
    getUserByEmail(email) {
      if (!email) return null;
      const row = selectUserByEmail.get(email) as UserRow | undefined;
      return row ? toAdapterUser(row) : null;
    },
    getUserByAccount(provider, providerAccountId) {
      const row = selectUserByAccount.get(provider, providerAccountId) as
        | UserRow
        | undefined;
      return row ? toAdapterUser(row) : null;
    },
    updateUser(user) {
      updateUser.run({
        id: user.id,
        name: user.name ?? null,
        email: user.email ?? null,
        email_verified: user.emailVerified
          ? user.emailVerified.toISOString()
          : null,
        image: user.image ?? null,
      });
      const row = selectUser.get(user.id) as UserRow | undefined;
      if (!row) {
        throw new Error(`User ${user.id} not found`);
      }
      return toAdapterUser(row);
    },
    linkAccount(account) {
      insertAccount.run({
        provider: account.provider,
        provider_account_id: account.providerAccountId,
        user_id: account.userId,
        type: account.type,
      });
    },
    unlinkAccount(provider, providerAccountId) {
      deleteAccount.run(provider, providerAccountId);
    },
    createSession(session) {
      insertSession.run({
        session_token: session.sessionToken,
        user_id: session.userId,
        expires: session.expires.toISOString(),
      });
      return session;
    },
    getSessionAndUser(sessionToken) {
      const session = selectSession.get(sessionToken) as SessionRow | undefined;
      if (!session) return null;
      const user = selectUser.get(session.user_id) as UserRow | undefined;
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
    updateSession(session) {
      updateSession.run({
        session_token: session.sessionToken,
        user_id: session.userId ?? null,
        expires: session.expires ? session.expires.toISOString() : null,
      });
      const row = selectSession.get(session.sessionToken) as
        | SessionRow
        | undefined;
      if (!row) return null;
      return {
        sessionToken: row.session_token,
        userId: row.user_id,
        expires: new Date(row.expires),
      };
    },
    deleteSession(sessionToken) {
      deleteSession.run(sessionToken);
    },
    createVerificationToken(token) {
      insertVerification.run({
        identifier: token.identifier,
        token: token.token,
        expires: token.expires.toISOString(),
      });
      return token;
    },
    useVerificationToken(params) {
      const row = takeVerification.get(params.identifier, params.token) as
        | VerificationRow
        | undefined;
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
      resolve().linkAccount(account);
    },
    unlinkAccount: async ({
      provider,
      providerAccountId,
    }: Pick<AdapterAccount, "provider" | "providerAccountId">) => {
      resolve().unlinkAccount(provider, providerAccountId);
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
      resolve().deleteSession(sessionToken);
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
