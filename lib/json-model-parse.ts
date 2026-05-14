import { jsonrepair } from "jsonrepair";

/**
 * Parse JSON from an LLM: try strict parse first, then `jsonrepair` for common
 * mistakes (unescaped newlines/tabs in strings, trailing commas, truncated braces, etc.).
 */
export function parseJsonWithRepair(raw: string): unknown {
  const trimmed = raw.replace(/^\uFEFF/, "").trim();
  const withoutNul = trimmed.replace(/\u0000/g, "");

  try {
    return JSON.parse(withoutNul);
  } catch (first) {
    try {
      return JSON.parse(jsonrepair(withoutNul));
    } catch {
      throw first instanceof Error ? first : new Error(String(first));
    }
  }
}
