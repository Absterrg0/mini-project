export function getCleanErrorMessage(error: unknown, fallbackMessage = "An unexpected error occurred"): string {
  // Always log the full, raw error to the server console for debugging.
  // Use a distinct prefix so it stands out in logs.
  console.error("[API_ERROR_LEAK_PREVENTION] Caught error:", error);

  const rawMessage = error instanceof Error ? error.message : String(error);
  const lowerMessage = rawMessage.toLowerCase();

  // Known ugly errors mapping
  if (lowerMessage.includes("quota exceeded") || lowerMessage.includes("429")) {
    if (lowerMessage.includes("generativelanguage") || lowerMessage.includes("gemini") || lowerMessage.includes("openai") || lowerMessage.includes("ai")) {
      return "AI provider quota exceeded or rate limited. Please check your billing details or try again later.";
    }
    return "API rate limit exceeded. Please try again later.";
  }

  if (lowerMessage.includes("fetch failed") || lowerMessage.includes("econnrefused") || lowerMessage.includes("timeout")) {
    return "Network error: Unable to communicate with an external service.";
  }

  if (lowerMessage.includes("malformed response") || lowerMessage.includes("unexpected token")) {
    return "Received an invalid response from an external service.";
  }

  // If it's none of the specific sanitized patterns, return the fallback message.
  // We DO NOT return rawMessage because it may contain sensitive paths, internal IPs, or overwhelming text.
  return fallbackMessage;
}
