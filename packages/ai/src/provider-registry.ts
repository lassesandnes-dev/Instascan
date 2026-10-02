import { AnthropicProvider } from "./providers/anthropic";
import { OpenAIProvider } from "./providers/openai";
import type { AIProvider, ProviderId } from "./types";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  model: string;
  configured: boolean;
}

/** Build providers from server-side environment variables. Keys never leave the server. */
export function createProvidersFromEnv(env: NodeJS.ProcessEnv = process.env): Record<ProviderId, AIProvider> {
  const effort = env.ANTHROPIC_EFFORT as "low" | "medium" | "high" | "xhigh" | "max" | undefined;
  return {
    openai: new OpenAIProvider({ apiKey: env.OPENAI_API_KEY || undefined, model: env.OPENAI_MODEL || undefined }),
    anthropic: new AnthropicProvider({
      apiKey: env.ANTHROPIC_API_KEY || undefined,
      model: env.ANTHROPIC_MODEL || undefined,
      effort: effort || undefined,
      fallbacks: env.ANTHROPIC_FALLBACKS === "off" ? "off" : "default",
    }),
  };
}

export function describeProviders(providers: Record<ProviderId, AIProvider>): ProviderInfo[] {
  return Object.values(providers).map((p) => ({ id: p.id, label: p.label, model: p.model, configured: p.isConfigured() }));
}
