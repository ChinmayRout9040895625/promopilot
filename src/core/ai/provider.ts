import type { z } from "zod";

export type ProviderName = "anthropic" | "gemini" | "openai-compatible" | "mock";

export interface LlmRequest {
  /** Short stable name used in logs and cache keys, e.g. "propose". */
  stage: string;
  system: string;
  user: string;
  /** Zod schema the response must satisfy. Adapters may use it for native structured output. */
  schema: z.ZodType;
  schemaName: string;
  maxTokens?: number;
}

export interface LlmResponse {
  text: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface LlmProvider {
  readonly name: ProviderName;
  readonly model: string;
  complete(req: LlmRequest, signal?: AbortSignal): Promise<LlmResponse>;
}

export type LlmErrorCode =
  | "rate_limited"
  | "overloaded"
  | "server_error"
  | "network"
  | "timeout"
  | "auth"
  | "bad_request"
  | "refusal"
  | "truncated"
  | "invalid_output"
  | "config"
  | "unknown";

/**
 * Provider-neutral error. Messages are written by us (never echo prompt content) so they are
 * safe to show in the UI and logs.
 */
export class LlmError extends Error {
  constructor(
    public readonly code: LlmErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export function isLlmError(e: unknown): e is LlmError {
  return e instanceof Error && e.name === "LlmError";
}
