import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./provider";

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  timeoutMs?: number;
  /** Server-side refusal fallbacks ("default" routing). Disable for models that do not support it. */
  fallbacks?: boolean;
}

function retryAfterMs(headers: unknown): number | undefined {
  const h = headers as { get?: (k: string) => string | null } | undefined;
  const v = h?.get?.("retry-after");
  if (!v) return undefined;
  const s = Number(v);
  return Number.isFinite(s) ? s * 1000 : undefined;
}

/** Maps SDK errors to provider-neutral LlmErrors, most specific first. */
export function mapAnthropicError(e: unknown): LlmError {
  if (e instanceof LlmError) return e;
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new LlmError("timeout", "Anthropic request timed out", true);
  if (e instanceof Anthropic.APIConnectionError) return new LlmError("network", "Could not reach Anthropic API", true);
  if (e instanceof Anthropic.AuthenticationError) return new LlmError("auth", "Anthropic API key is missing or invalid", false, 401);
  if (e instanceof Anthropic.PermissionDeniedError) return new LlmError("auth", "Anthropic key lacks permission for this model", false, 403);
  if (e instanceof Anthropic.NotFoundError) return new LlmError("config", "Anthropic model not found; check AI_MODEL", false, 404);
  if (e instanceof Anthropic.RateLimitError) return new LlmError("rate_limited", "Anthropic rate limit hit", true, 429, retryAfterMs(e.headers));
  if (e instanceof Anthropic.BadRequestError) return new LlmError("bad_request", `Anthropic rejected the request (400): ${e.message.slice(0, 200)}`, false, 400);
  if (e instanceof Anthropic.InternalServerError) {
    if (e.status === 529) return new LlmError("overloaded", "Anthropic API overloaded", true, 529, retryAfterMs(e.headers));
    return new LlmError("server_error", `Anthropic server error (${e.status})`, true, e.status, retryAfterMs(e.headers));
  }
  if (e instanceof Anthropic.APIError) {
    const status = e.status ?? 0;
    if (status === 529) return new LlmError("overloaded", "Anthropic API overloaded", true, 529);
    return new LlmError(status >= 500 ? "server_error" : "unknown", `Anthropic API error (${status})`, status >= 500, status);
  }
  return new LlmError("unknown", e instanceof Error ? e.message : String(e), false);
}

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic" as const;
  readonly model: string;
  private client: Anthropic;
  private effort?: AnthropicOptions["effort"];
  private fallbacks: boolean;

  constructor(opts: AnthropicOptions) {
    this.model = opts.model;
    this.effort = opts.effort;
    this.fallbacks = opts.fallbacks ?? true;
    // SDK retries are disabled: callJson owns retry/backoff so behaviour is identical across providers.
    this.client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 0, timeout: opts.timeoutMs ?? 55000 });
  }

  async complete(req: LlmRequest, signal?: AbortSignal): Promise<LlmResponse> {
    let response;
    try {
      response = await this.client.beta.messages.create(
        {
          model: this.model,
          max_tokens: req.maxTokens ?? 16000,
          system: req.system,
          messages: [{ role: "user", content: req.user }],
          output_config: {
            format: betaZodOutputFormat(req.schema),
            ...(this.effort ? { effort: this.effort } : {}),
          },
          ...(this.fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        },
        { signal },
      );
    } catch (e) {
      throw mapAnthropicError(e);
    }
    if (response.stop_reason === "refusal") {
      throw new LlmError("refusal", "Model declined this request (refusal)", false);
    }
    if (response.stop_reason === "max_tokens") {
      throw new LlmError("truncated", "Model output was truncated (max_tokens)", true);
    }
    const text = response.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
    return {
      text,
      model: response.model ?? this.model,
      usage: { inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens },
    };
  }
}
