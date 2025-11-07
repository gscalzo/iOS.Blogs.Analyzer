const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "llama3.1";
const MODEL_ENV_VARIABLE = "IOS_BLOGS_ANALYZER_MODEL";
const SUPPORTED_MODELS = ["llama3.1", "qwq"] as const;

type SupportedModel = (typeof SUPPORTED_MODELS)[number];

export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchLike = (input: string, init?: FetchInit) => Promise<FetchResponse>;

export interface OllamaClientOptions {
  readonly baseUrl?: string;
  readonly model?: string;
  readonly fetcher?: FetchLike;
}

export interface AnalyzeTextOptions {
  readonly model?: string;
  readonly signal?: AbortSignal;
}

interface GenerateResponse {
  response?: string;
}

export interface AnalysisResult {
  relevant: boolean;
  confidence?: number;
  reason?: string;
  tags?: string[];
  rawResponse: string;
}

export class OllamaConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OllamaConfigurationError";
  }
}

export class OllamaRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "OllamaRequestError";
  }
}

export class OllamaParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OllamaParseError";
  }
}

export class OllamaClient {
  private readonly baseUrl: string;
  private readonly fetcher: FetchLike;
  private readonly defaultModel: SupportedModel;

  constructor(options: OllamaClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetcher = this.resolveFetcher(options.fetcher);
    this.defaultModel = this.resolveModel(options.model);
  }

  get model(): SupportedModel {
    return this.defaultModel;
  }

  async checkConnection(options: { signal?: AbortSignal } = {}): Promise<boolean> {
    const response = await this.fetcher(this.joinUrl("/api/tags"), {
      method: "GET",
      signal: options.signal,
    });

    if (!response.ok) {
      const detail = await this.extractErrorDetail(response);
      throw new OllamaRequestError(`Unable to reach Ollama: ${detail}`, response.status);
    }

    return true;
  }

  async analyze(description: string, options: AnalyzeTextOptions = {}): Promise<AnalysisResult> {
    if (!description?.trim()) {
      throw new OllamaConfigurationError("Description must be a non-empty string");
    }

    const model = this.resolveModel(options.model, { allowDefault: true });
    const payload = {
      model,
      prompt: this.buildPrompt(description),
      stream: false,
    } as const;

    const response = await this.fetcher(this.joinUrl("/api/generate"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: options.signal,
    });

    if (!response.ok) {
      const detail = await this.extractErrorDetail(response);
      throw new OllamaRequestError(`Ollama generation failed: ${detail}`, response.status);
    }

    const data = (await response.json()) as GenerateResponse;
    const answer = data.response?.trim();

    if (!answer) {
      throw new OllamaRequestError("Ollama response did not include a decision", response.status);
    }

    return this.parseDecision(answer);
  }

  async analyzeText(description: string, options: AnalyzeTextOptions = {}): Promise<boolean> {
    const result = await this.analyze(description, options);
    return result.relevant;
  }

  private resolveFetcher(fetcher?: FetchLike): FetchLike {
    if (fetcher) {
      return fetcher;
    }

    const globalFetch = (globalThis as { fetch?: FetchLike }).fetch;

    if (!globalFetch) {
      throw new OllamaConfigurationError("fetch is not available; provide a custom fetcher");
    }

    return globalFetch.bind(globalThis);
  }

  private resolveModel(model?: string, options: { allowDefault?: boolean } = {}): SupportedModel {
    const candidates = [model, process.env[MODEL_ENV_VARIABLE], options.allowDefault ? this.defaultModel : DEFAULT_MODEL];
    const resolved = candidates.find((value) => typeof value === "string" && value.trim().length > 0);

    if (!resolved) {
      throw new OllamaConfigurationError("Unable to determine Ollama model to use");
    }

    const normalized = resolved.trim();

    if (!SUPPORTED_MODELS.includes(normalized as SupportedModel)) {
      throw new OllamaConfigurationError(
        `Unsupported Ollama model "${normalized}". Supported models: ${SUPPORTED_MODELS.join(", ")}`,
      );
    }

    return normalized as SupportedModel;
  }

  private joinUrl(path: string): string {
    return `${this.baseUrl.replace(/\/$/, "")}${path}`;
  }

  private async extractErrorDetail(response: FetchResponse): Promise<string> {
    try {
      const text = await response.text();
      return text ? `${response.status} ${response.statusText}: ${text}` : `${response.status} ${response.statusText}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return `${response.status} ${response.statusText} (failed to read body: ${message})`;
    }
  }

  private buildPrompt(description: string): string {
    const trimmed = description.trim();
    return [
      "You are an expert iOS engineer helping triage blog posts for AI/mobile relevance.",
      "Decide if the post focuses on iOS development topics that involve AI/ML, Core ML, vision models, or advanced mobile engineering techniques.",
      "Respond with a JSON object using this schema strictly:",
      '{"relevant": boolean, "confidence": number (0-1), "reason": string, "tags": string[]}',
      "Rules:\n- relevant must be true only when the summary clearly indicates AI/ML or advanced mobile engineering for iOS.\n- confidence should be between 0 and 1.\n- tags must be 1-3 lowercase keywords summarizing the topic.",
      "Output only the JSON object with no extra commentary.",
      "Blog post summary:",
      trimmed,
    ].join("\n\n");
  }

  private parseDecision(answer: string): AnalysisResult {
    const jsonCandidate = this.extractJsonBlock(answer);
    if (!jsonCandidate) {
      const fallback = this.parseFallbackDecision(answer);
      if (fallback) {
        return fallback;
      }
      throw new OllamaParseError("Unable to locate JSON response in Ollama output");
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(jsonCandidate);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      throw new OllamaParseError(`Failed to parse Ollama JSON response: ${message}`);
    }

    if (!parsed || typeof parsed !== "object") {
      throw new OllamaParseError("Ollama response JSON is not an object");
    }

    const record = parsed as Record<string, unknown>;
    const relevant = this.normalizeRelevant(record.relevant ?? record.isRelevant ?? record.relevance ?? record.decision);

    if (typeof relevant !== "boolean") {
      throw new OllamaParseError("Ollama JSON response did not include a boolean relevance decision");
    }

    const confidence = this.normalizeConfidence(record.confidence ?? record.score ?? record.probability);
    const reason = this.normalizeReason(record.reason ?? record.explanation ?? record.summary);
    const tags = this.normalizeTags(record.tags ?? record.labels ?? record.topics);

    return {
      relevant,
      confidence,
      reason,
      tags,
      rawResponse: answer,
    };
  }

  private extractJsonBlock(answer: string): string | undefined {
    const start = answer.indexOf("{");
    const end = answer.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      return undefined;
    }

    return answer.slice(start, end + 1);
  }

  private parseFallbackDecision(answer: string): AnalysisResult | undefined {
    const yes = /^\s*yes\b/i.test(answer);
    const no = /^\s*no\b/i.test(answer);

    if (!yes && !no) {
      return undefined;
    }

    return {
      relevant: yes,
      confidence: undefined,
      reason: undefined,
      tags: undefined,
      rawResponse: answer,
    };
  }

  private normalizeRelevant(value: unknown): boolean | undefined {
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      if (/^yes\b/i.test(value)) {
        return true;
      }

      if (/^no\b/i.test(value)) {
        return false;
      }
    }

    return undefined;
  }

  private normalizeConfidence(value: unknown): number | undefined {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return undefined;
    }

    const clamped = Math.max(0, Math.min(1, value));
    return clamped;
  }

  private normalizeReason(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private normalizeTags(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }

    const tags = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0);

    return tags.length > 0 ? tags.slice(0, 3) : undefined;
  }
}

export function createOllamaClient(options?: OllamaClientOptions): OllamaClient {
  return new OllamaClient(options);
}