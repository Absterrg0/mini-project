import { cookies } from "next/headers";
import { COOKIE_NAME, type AISettings } from "./ai-provider";

/** Read AI settings from the httpOnly cookie — server components / route handlers only. */
export async function getAISettings(): Promise<AISettings | null> {
  try {
    const jar = await cookies();
    const raw = jar.get(COOKIE_NAME)?.value;
    if (!raw) return null;
    const parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as AISettings;
    if (!parsed.apiKey || !parsed.provider || !parsed.model) return null;
    return parsed;
  } catch {
    return null;
  }
}
