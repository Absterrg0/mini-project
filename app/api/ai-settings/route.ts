import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { COOKIE_NAME, type AISettings, type AIProvider, AI_MODELS } from "@/lib/ai-provider";

const VALID_PROVIDERS = new Set<AIProvider>(["openai", "anthropic", "google"]);

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Read cookie from request — can't use next/headers cookies() in GET easily,
  // so we parse the cookie header directly.
  const cookieHeader = (await headers()).get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  if (!match) return NextResponse.json({ configured: false });

  try {
    const parsed = JSON.parse(Buffer.from(decodeURIComponent(match[1]), "base64").toString("utf8")) as AISettings;
    // Never send the key back — just confirm config and return safe fields
    return NextResponse.json({
      configured: true,
      provider: parsed.provider,
      model: parsed.model,
      keyPrefix: parsed.apiKey.slice(0, 8) + "••••",
    });
  } catch {
    return NextResponse.json({ configured: false });
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as { provider?: string; model?: string; apiKey?: string; clear?: boolean };

  if (body.clear) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, "", { httpOnly: true, secure: true, sameSite: "lax", maxAge: 0, path: "/" });
    return res;
  }

  const provider = body.provider as AIProvider;
  if (!VALID_PROVIDERS.has(provider)) {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }
  let apiKey = body.apiKey;
  if (!apiKey) {
    const cookieHeader = request.headers.get("cookie") ?? (await headers()).get("cookie") ?? "";
    const match = cookieHeader.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
    if (match) {
      try {
        const parsed = JSON.parse(Buffer.from(decodeURIComponent(match[1]), "base64").toString("utf8")) as AISettings;
        apiKey = parsed.apiKey;
      } catch {}
    }
  }

  if (!body.model || !apiKey) {
    return NextResponse.json({ error: "model and apiKey are required" }, { status: 400 });
  }


  // Validate model belongs to provider
  const validModels = AI_MODELS[provider].models.map((m) => m.value);
  if (!validModels.includes(body.model)) {
    return NextResponse.json({ error: "Invalid model for provider" }, { status: 400 });
  }

  const settings: AISettings = { provider, model: body.model, apiKey };
  const encoded = Buffer.from(JSON.stringify(settings), "utf8").toString("base64");

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, encoded, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    path: "/",
  });
  return res;
}

