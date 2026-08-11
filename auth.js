import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

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
    }),
  ],
  pages: {
    signIn: "/admin",
    error: "/admin",
  },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return false;
      return Boolean(profile?.email_verified && profile?.email);
    },
    async session({ session }) {
      const email = session.user?.email?.toLowerCase();
      const isOwner = Boolean(email && email === ownerEmail());
      session.user.isOwner = isOwner;
      session.user.role = isOwner ? "owner" : "contributor";
      return session;
    },
  },
});
