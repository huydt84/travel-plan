import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { ADMIN_ROUTES } from "./lib/admin-routes.mjs";
import { recordUserLogin } from "./lib/user-repository";
import { resolveLocalAdminMode } from "./lib/runtime-config.mjs";

import { googleLoginParams, createGoogleAuthCallbacks } from "./lib/google-auth-policy.mjs";
export { GMAIL_SEND_SCOPE, BASIC_GOOGLE_SCOPE } from "./lib/google-auth-policy.mjs";

export const ownerEmail = () => {
  if (resolveLocalAdminMode().enabled) return "local-admin@localhost.invalid";
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
        params: googleLoginParams,
      },
    }),
  ],
  pages: {
    signIn: ADMIN_ROUTES.trips,
    error: "/auth/invitation-error",
  },
  callbacks: createGoogleAuthCallbacks(ownerEmail),
  events: {
    async signIn({ user, profile }) {
      await recordUserLogin({
        name: user.name || profile?.name,
        email: user.email || profile?.email,
      });
    },
  },
});
