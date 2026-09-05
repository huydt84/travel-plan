export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const BASIC_GOOGLE_SCOPE = "openid email profile";
export const googleLoginParams = {
  scope: BASIC_GOOGLE_SCOPE, response_type: "code", include_granted_scopes: "true",
};
export const googleMailConsentParams = {
  ...googleLoginParams,
  scope: `${BASIC_GOOGLE_SCOPE} ${GMAIL_SEND_SCOPE}`,
  access_type: "offline", prompt: "consent",
};

export function createGoogleAuthCallbacks(ownerEmail) {
  return {
    async signIn({ account, profile }) {
      return account?.provider === "google" && Boolean(profile?.email_verified && profile?.email);
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
      session.user.isAdmin = isOwner;
      session.user.role = isOwner ? "owner" : "member";
      return session;
    },
  };
}
