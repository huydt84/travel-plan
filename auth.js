import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { ADMIN_ROUTES } from "./lib/admin-routes.mjs";
import { recordUserLogin } from "./lib/user-repository";

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const BASIC_GOOGLE_SCOPE = "openid email profile";

export const ownerEmail = () => {
  const email = process.env.AUTH_OWNER_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error("AUTH_OWNER_EMAIL is missing from the process environment.");
  return email;
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: {
        params: {
          scope: BASIC_GOOGLE_SCOPE,
          response_type: "code",
          include_granted_scopes: "true",
        },
      },
    }),
  ],
  pages: {
    signIn: ADMIN_ROUTES.trips,
    error: "/auth/invitation-error",
  },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return false;
      return Boolean(profile?.email_verified && profile?.email);
    },
    async jwt({ token, account }) {
      if (account?.provider === "google") {
        token.googleAccessToken = account.access_token;
        token.googleRefreshToken = account.refresh_token || token.googleRefreshToken;
        token.googleAccessTokenExpiresAt = account.expires_at;
        token.googleScope = account.scope;
      }
      return token;
    },
    async session({ session }) {
      const email = session.user?.email?.toLowerCase();
      const isOwner = Boolean(email && email === ownerEmail());
      session.user.isOwner = isOwner;
      session.user.role = isOwner ? "owner" : "contributor";
      return session;
    },
  },
  events: {
    async signIn({ user, profile }) {
      await recordUserLogin({
        name: user.name || profile?.name,
        email: user.email || profile?.email,
      });
    },
  },
});
