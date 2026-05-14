import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function uniqueOrganizationSlug(baseSlug: string) {
  const fallback = baseSlug || "workspace";
  let slug = fallback;
  let suffix = 2;

  while (await prisma.executionOrganization.findUnique({ where: { slug } })) {
    slug = `${fallback}-${suffix}`;
    suffix += 1;
  }

  return slug;
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return NextResponse.json({ error: "Sign in before creating an organization." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (name.length < 2) {
    return NextResponse.json({ error: "Organization name must be at least 2 characters." }, { status: 400 });
  }

  if (name.length > 80) {
    return NextResponse.json({ error: "Organization name must be 80 characters or less." }, { status: 400 });
  }

  const slug = await uniqueOrganizationSlug(slugify(name));
  const organization = await prisma.executionOrganization.create({
    data: {
      name,
      slug,
      plan: "trial",
      ingestionCheckpoints: {
        create: {
          syncCursor: "",
          eventsProcessed24h: 0,
          webhookDeliveryPct: 0,
          status: "pending",
          checks: [
            {
              id: "github-app",
              label: "GitHub App installation",
              status: "blocked",
              detail: "Install the GitHub App to sync repositories and workflow runs.",
              latencyMs: 0,
            },
            {
              id: "workflow-backfill",
              label: "Workflow history backfill",
              status: "blocked",
              detail: "Backfill starts after at least one repository is available.",
              latencyMs: 0,
            },
            {
              id: "runtime-telemetry",
              label: "Runtime telemetry enrichment",
              status: "warning",
              detail: "Optional wrapper tokens can be created after repositories sync.",
              latencyMs: 0,
            },
          ],
        },
      },
    },
  });

  return NextResponse.json({
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    },
  });
}
