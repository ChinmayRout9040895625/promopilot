import { OpenAICompatibleProvider } from "./openaiCompatible";

export { toCompatSchema } from "./openaiCompatible";

export const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

export interface GeminiOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Gemini through its OpenAI-compatible chat completions endpoint (a preset of the generic adapter). */
export class GeminiProvider extends OpenAICompatibleProvider {
  constructor(opts: GeminiOptions) {
    super({ ...opts, baseUrl: opts.baseUrl ?? DEFAULT_GEMINI_BASE_URL, name: "gemini", label: "Gemini", responseFormat: "json_schema" });
  }
}
