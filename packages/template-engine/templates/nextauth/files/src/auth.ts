import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import authConfig from "./auth.config";

// import { PrismaAdapter } from "@auth/prisma-adapter";
// import { prisma } from "./db";

interface AppUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
}

// TODO: replace this stub with a real lookup against your user store
// (e.g. prisma.user.findUnique({ where: { email } })).
async function lookupUser(_email: string): Promise<AppUser | null> {
  return null;
}

// Full auth instance: extends the Edge-safe config with the Node-only Credentials
// provider and (optionally) a database adapter. Import { auth } here from server
// components / route handlers; the middleware uses auth.config directly.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // session_strategy: "jwt" (default) keeps sessions stateless; "database" requires an adapter.
  session: { strategy: "{session_strategy}" as "jwt" | "database" },
  // For session_strategy=database, install @auth/prisma-adapter and uncomment:
  // adapter: PrismaAdapter(prisma),
  providers: [
    ...authConfig.providers,
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }
        const user = await lookupUser(email);
        if (!user) return null;
        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.id && session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});
