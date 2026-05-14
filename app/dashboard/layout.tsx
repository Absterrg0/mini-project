import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppSidebar } from "@/components/layout/sidebar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  // Lean query — just what the sidebar needs, no workflow runs
  const org = await prisma.executionOrganization.findFirst({
    include: { repositories: { select: { id: true, name: true, fullName: true }, orderBy: { fullName: "asc" } } },
    orderBy: { name: "asc" },
  });

  const repos = org?.repositories ?? [];

  return (
    <SidebarProvider>
      <AppSidebar
        userName={session.user.name ?? "Operator"}
        userEmail={session.user.email ?? ""}
        userImage={session.user.image}
        orgName={org?.name}
        repos={repos}
      />
      <SidebarInset className="bg-background min-h-screen">
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
