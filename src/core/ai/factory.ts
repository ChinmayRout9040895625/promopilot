import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import { OpenAICompatibleProvider, type ResponseFormatMode } from "./openaiCompatible";
import type { LlmProvider } from "./provider";

export type AiMode = "anthropic" | "gemini" | "openai-compatible" | "none";

export interface ProviderConfig {
  mode: AiMode;
  provider: LlmProvider | null;
  model: string;
  /** Why AI is unavailable, when it is. Safe to show to users (never contains secrets). */
  reason?: string;
}

type Env = Record<string, string | undefined>;

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const FORMATS: ResponseFormatMode[] = ["json_schema", "json_object", "none"];
const OPENAI_BASE_URL = "https://api.openai.com/v1";

/**
 * Builds the provider from environment variables. Never throws: a misconfiguration
 * yields heuristic mode plus a human-readable reason.
 *
 *   AI_PROVIDER=anthropic          ANTHROPIC_API_KEY
 *   AI_PROVIDER=gemini             GEMINI_API_KEY [GEMINI_BASE_URL]
 *   AI_PROVIDER=openai-compatible  OPENAI_COMPAT_BASE_URL OPENAI_COMPAT_API_KEY [OPENAI_COMPAT_RESPONSE_FORMAT]
 *   AI_PROVIDER=openai             same as openai-compatible, base URL defaults to OpenAI
 */
export function providerFromEnv(env: Env): ProviderConfig {
  const raw = (env.AI_PROVIDER ?? "").trim().toLowerCase();
  const model = (env.AI_MODEL ?? "").trim();
  const timeoutMs = Number(env.AI_TIMEOUT_MS) > 0 ? Number(env.AI_TIMEOUT_MS) : 55000;

  if (raw === "" || raw === "none" || raw === "heuristic") {
    return { mode: "none", provider: null, model: "", reason: "AI_PROVIDER is set to none" };
  }
  const known = ["anthropic", "gemini", "openai-compatible", "openai"];
  if (!known.includes(raw)) {
    return { mode: "none", provider: null, model: "", reason: `Unknown AI_PROVIDER "${raw}" (use anthropic, gemini, openai-compatible or none)` };
  }
  if (!model) return { mode: "none", provider: null, model: "", reason: "AI_MODEL is not set" };

  if (raw === "anthropic") {
    const key = env.ANTHROPIC_API_KEY?.trim();
    if (!key) return { mode: "none", provider: null, model, reason: "ANTHROPIC_API_KEY is not set" };
    const effortRaw = env.AI_EFFORT?.trim().toLowerCase();
    const effort = EFFORTS.find((e) => e === effortRaw);
    const fallbacks = (env.ANTHROPIC_FALLBACKS ?? "default").trim().toLowerCase() !== "off";
    return { mode: "anthropic", provider: new AnthropicProvider({ apiKey: key, model, effort, timeoutMs, fallbacks }), model };
  }

  if (raw === "gemini") {
    const key = env.GEMINI_API_KEY?.trim();
    if (!key) return { mode: "none", provider: null, model, reason: "GEMINI_API_KEY is not set" };
    return {
      mode: "gemini",
      provider: new GeminiProvider({ apiKey: key, model, baseUrl: env.GEMINI_BASE_URL?.trim() || undefined, timeoutMs }),
      model,
    };
  }

  // openai-compatible (or the "openai" shorthand)
  const baseUrl = env.OPENAI_COMPAT_BASE_URL?.trim() || (raw === "openai" ? OPENAI_BASE_URL : "");
  if (!baseUrl) return { mode: "none", provider: null, model, reason: "OPENAI_COMPAT_BASE_URL is not set" };
  const key = (env.OPENAI_COMPAT_API_KEY ?? env.OPENAI_API_KEY)?.trim();
  if (!key) return { mode: "none", provider: null, model, reason: "OPENAI_COMPAT_API_KEY is not set" };
  const fmtRaw = (env.OPENAI_COMPAT_RESPONSE_FORMAT ?? "json_schema").trim().toLowerCase() as ResponseFormatMode;
  const responseFormat = FORMATS.includes(fmtRaw) ? fmtRaw : "json_schema";
  return {
    mode: "openai-compatible",
    provider: new OpenAICompatibleProvider({ apiKey: key, model, baseUrl, timeoutMs, responseFormat }),
    model,
  };
}
