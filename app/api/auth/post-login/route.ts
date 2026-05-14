import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST-LOGIN redirect handler.
 *
 * better-auth calls callbackURL after a successful OAuth sign-in.
 * We use that opportunity to check whether the user has already installed
 * the GitHub App (i.e. an org with an installationId exists in the DB).
 *
 *   - No org / no installation → first-time user → /onboarding
 *   - Has org with installation → returning user  → /dashboard
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });

  // Not authenticated somehow — send back to sign-in
  if (!session) {
    redirect("/sign-in");
  }

  const connectedOrg = await prisma.executionOrganization.findFirst({
    where: { githubAppInstallationId: { not: null } },
    select: { id: true },
  });

  if (!connectedOrg) {
    // No GitHub App connected yet — guide them through setup
    redirect("/onboarding");
  }

  redirect("/dashboard");
}
