import { z } from "zod";
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse, type ProviderName } from "./provider";

/**
 * How to ask the server for JSON:
 *  - json_schema: native structured output (OpenAI, Gemini's compat endpoint, many gateways)
 *  - json_object: "any JSON" mode; the schema is added to the system prompt
 *  - none: plain chat; the schema is added to the system prompt
 * Zod validation of the reply applies in every mode.
 */
export type ResponseFormatMode = "json_schema" | "json_object" | "none";

export interface OpenAICompatibleOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  /** Provider name used in logs and run metadata. */
  name?: ProviderName;
  /** Human label used in error messages, e.g. "Gemini". */
  label?: string;
  responseFormat?: ResponseFormatMode;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Removes JSON-Schema keywords that OpenAI-compatible endpoints commonly reject. */
export function toCompatSchema(schema: z.ZodType): Record<string, unknown> {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        if (k === "$schema" || k === "additionalProperties" || k === "$id") continue;
        out[k] = strip(v);
      }
      return out;
    }
    return node;
  };
  return strip(z.toJSONSchema(schema)) as Record<string, unknown>;
}

function mapStatus(label: string, status: number, retryAfter: string | null): LlmError {
  const ra = retryAfter && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : undefined;
  if (status === 401 || status === 403) return new LlmError("auth", `${label} API key is missing or invalid`, false, status);
  if (status === 404) return new LlmError("config", `${label} model or endpoint not found; check AI_MODEL and the base URL`, false, status);
  if (status === 429) return new LlmError("rate_limited", `${label} rate limit or quota hit`, true, status, ra);
  if (status === 400) return new LlmError("bad_request", `${label} rejected the request (400)`, false, status);
  if (status === 503) return new LlmError("overloaded", `${label} API overloaded`, true, status, ra);
  if (status >= 500) return new LlmError("server_error", `${label} server error (${status})`, true, status);
  return new LlmError("unknown", `${label} API error (${status})`, false, status);
}

/** Any chat-completions API that follows the OpenAI request/response shape. */
export class OpenAICompatibleProvider implements LlmProvider {
  readonly name: ProviderName;
  readonly model: string;
  protected label: string;
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;
  private responseFormat: ResponseFormatMode;
  private fetchImpl: typeof fetch;

  constructor(opts: OpenAICompatibleOptions) {
    this.name = opts.name ?? "openai-compatible";
    this.label = opts.label ?? "OpenAI-compatible";
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 55000;
    this.responseFormat = opts.responseFormat ?? "json_schema";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async complete(req: LlmRequest, signal?: AbortSignal): Promise<LlmResponse> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const schema = toCompatSchema(req.schema);
    const system =
      this.responseFormat === "json_schema"
        ? req.system
        : `${req.system}\n\nReply with a single JSON object, and nothing else, that matches this JSON Schema:\n${JSON.stringify(schema)}`;
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: req.maxTokens ?? 16000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: req.user },
      ],
    };
    if (this.responseFormat === "json_schema") body.response_format = { type: "json_schema", json_schema: { name: req.schemaName, schema } };
    if (this.responseFormat === "json_object") body.response_format = { type: "json_object" };

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch {
      if (timeout.aborted) throw new LlmError("timeout", `${this.label} request timed out`, true);
      if (signal?.aborted) throw new LlmError("timeout", "Request aborted", false);
      throw new LlmError("network", `Could not reach ${this.label} API`, true);
    }
    if (!res.ok) throw mapStatus(this.label, res.status, res.headers.get("retry-after"));
    let parsed: {
      model?: string;
      choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      parsed = await res.json();
    } catch {
      throw new LlmError("invalid_output", `${this.label} returned a non-JSON HTTP body`, true);
    }
    const choice = parsed.choices?.[0];
    if (!choice) throw new LlmError("invalid_output", `${this.label} returned no choices`, true);
    if (choice.message?.refusal) throw new LlmError("refusal", "Model declined this request", false);
    if (choice.finish_reason === "length") throw new LlmError("truncated", "Model output was truncated (length)", true);
    if (choice.finish_reason === "content_filter") throw new LlmError("refusal", "Response blocked by content filter", false);
    return {
      text: choice.message?.content ?? "",
      model: parsed.model ?? this.model,
      usage: { inputTokens: parsed.usage?.prompt_tokens, outputTokens: parsed.usage?.completion_tokens },
    };
  }
}
