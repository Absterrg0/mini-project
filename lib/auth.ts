import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "./prisma";

const githubClientId = process.env.GITHUB_CLIENT_ID;
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
const githubEnabled = Boolean(githubClientId && githubClientSecret);
const authSecret =
  process.env.BETTER_AUTH_SECRET ??
  "development-secret-change-this-before-production-please";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: authSecret,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  session: {
    // Cache session in a signed cookie for 5 minutes to avoid
    // a DB roundtrip on every server-rendered page request.
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
  },
  socialProviders: githubEnabled
    ? {
        github: {
          clientId: githubClientId as string,
          clientSecret: githubClientSecret as string,
          scope: ["read:user", "user:email"],
        },
      }
    : {},
  plugins: [nextCookies()],
});

