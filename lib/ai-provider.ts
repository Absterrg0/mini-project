import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

export type AIProvider = "openai" | "anthropic" | "google";

export const AI_MODELS: Record<AIProvider, { label: string; models: { value: string; label: string }[] }> = {
  openai: {
    label: "OpenAI",
    models: [
      { value: "gpt-5.5",      label: "GPT-5.5" },
      { value: "gpt-5.4",      label: "GPT-5.4" },
      { value: "gpt-5.4-mini", label: "GPT-5.4 mini" },
      { value: "gpt-4o",       label: "GPT-4o" },
      { value: "gpt-4o-mini",  label: "GPT-4o mini" },
    ],
  },
  anthropic: {
    label: "Anthropic",
    models: [
      { value: "claude-opus-4-7",         label: "Claude Opus 4.7" },
      { value: "claude-sonnet-4-6",       label: "Claude Sonnet 4.6" },
      { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
      { value: "claude-opus-4-5",         label: "Claude Opus 4.5" },
      { value: "claude-sonnet-4-5",       label: "Claude Sonnet 4.5" },
    ],
  },
  google: {
    label: "Google",
    models: [
      { value: "gemini-3.1-pro-preview",  label: "Gemini 3.1 Pro" },
      { value: "gemini-3-flash-preview",  label: "Gemini 3 Flash" },
      { value: "gemini-2.5-pro",          label: "Gemini 2.5 Pro" },
      { value: "gemini-2.5-flash",        label: "Gemini 2.5 Flash" },
      { value: "gemini-2.5-flash-lite",   label: "Gemini 2.5 Flash-Lite" },
    ],
  },
};

export const COOKIE_NAME = "ef_ai_settings";

export interface AISettings {
  provider: AIProvider;
  model: string;
  apiKey: string;
}

/** Build a Vercel AI SDK language model from stored settings. */
export function buildAIModel(settings: AISettings) {
  switch (settings.provider) {
    case "openai": {
      const client = createOpenAI({ apiKey: settings.apiKey });
      return client(settings.model);
    }
    case "anthropic": {
      const client = createAnthropic({ apiKey: settings.apiKey });
      return client(settings.model);
    }
    case "google": {
      const client = createGoogleGenerativeAI({ apiKey: settings.apiKey });
      return client(settings.model);
    }
  }
}
