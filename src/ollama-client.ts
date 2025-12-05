const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "llama3.1";
const MODEL_ENV_VARIABLE = "IOS_BLOGS_ANALYZER_MODEL";
const SUPPORTED_MODEL_PREFIXES = ["llama3.1", "qwq"] as const;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_RETRY_MULTIPLIER = 2;

type SupportedModel = string;

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
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
  readonly retryMultiplier?: number;
}

export interface AnalyzeTextOptions {
  readonly model?: string;
  readonly signal?: AbortSignal;
  readonly gracefulDegradation?: boolean;
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

export class OllamaTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OllamaTimeoutError";
  }
}

export class OllamaUnavailableError extends Error {
  readonly attempts: number;

  constructor(message: string, { cause, attempts }: { cause?: unknown; attempts: number }) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "OllamaUnavailableError";
    this.attempts = attempts;
  }
}

export class OllamaClient {
  private readonly baseUrl: string;
  private readonly fetcher: FetchLike;
  private readonly defaultModel: SupportedModel;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly retryMultiplier: number;
  private availableModels?: string[];
  private readonly resolvedModelCache = new Map<string, string>();

  constructor(options: OllamaClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetcher = this.resolveFetcher(options.fetcher);
    this.defaultModel = this.resolveModel(options.model);
    this.timeoutMs = this.normalizeTimeout(options.timeoutMs);
    this.maxRetries = this.normalizeRetryCount(options.maxRetries);
    this.retryDelayMs = this.normalizeDelay(options.retryDelayMs);
    this.retryMultiplier = this.normalizeMultiplier(options.retryMultiplier);
  }

  get model(): SupportedModel {
    return this.defaultModel;
  }

  async checkConnection(options: { signal?: AbortSignal } = {}): Promise<boolean> {
    await this.executeWithRetry(
      async () => {
        const response = await this.performFetch("/api/tags", { method: "GET" }, options.signal);

        if (!response.ok) {
          const detail = await this.extractErrorDetail(response);
          throw new OllamaRequestError(`Unable to reach Ollama: ${detail}`, response.status);
        }

        await this.captureAvailableModels(response);
        return true;
      },
      { signal: options.signal },
    );

    return true;
  }

  async analyze(description: string, options: AnalyzeTextOptions = {}): Promise<AnalysisResult> {
    if (!description?.trim()) {
      throw new OllamaConfigurationError("Description must be a non-empty string");
    }

    const desiredModel = this.resolveModel(options.model, { allowDefault: true });
    const model = this.selectInstalledModel(desiredModel);
    const payload = {
      model,
      prompt: this.buildPrompt(description),
      stream: false,
    } as const;

    try {
      const response = await this.executeWithRetry(
        async () => {
          const httpResponse = await this.performFetch(
            "/api/generate",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify(payload),
            },
            options.signal,
          );

          if (!httpResponse.ok) {
            const detail = await this.extractErrorDetail(httpResponse);
            throw new OllamaRequestError(`Ollama generation failed: ${detail}`, httpResponse.status);
          }

          return httpResponse;
        },
        { signal: options.signal },
      );

      const data = (await response.json()) as GenerateResponse;
      const answer = data.response?.trim();

      if (!answer) {
        throw new OllamaRequestError("Ollama response did not include a decision", response.status);
      }

      return this.parseDecision(answer);
    } catch (error) {
      if (options.gracefulDegradation && this.isGracefulFailure(error)) {
        return this.createFallbackAnalysis(error);
      }

      throw error;
    }
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

    if (!this.isSupportedModel(normalized)) {
      throw new OllamaConfigurationError(
        `Unsupported Ollama model "${normalized}". Supported models: ${SUPPORTED_MODEL_PREFIXES.join(", ")}`,
      );
    }

    return normalized as SupportedModel;
  }
  private isSupportedModel(candidate: string): boolean {
    return SUPPORTED_MODEL_PREFIXES.some((prefix) => candidate === prefix || candidate.startsWith(`${prefix}:`));
  }

  private normalizeTimeout(timeout?: number): number {
    if (typeof timeout === "number" && Number.isFinite(timeout) && timeout >= 0) {
      return timeout;
    }

    return DEFAULT_TIMEOUT_MS;
  }

  private normalizeRetryCount(count?: number): number {
    if (typeof count === "number" && Number.isInteger(count) && count >= 0) {
      return count;
    }

    return DEFAULT_MAX_RETRIES;
  }

  private normalizeDelay(delay?: number): number {
    if (typeof delay === "number" && Number.isFinite(delay) && delay >= 0) {
      return delay;
    }

    return DEFAULT_RETRY_DELAY_MS;
  }

  private normalizeMultiplier(multiplier?: number): number {
    if (typeof multiplier === "number" && Number.isFinite(multiplier) && multiplier >= 1) {
      return multiplier;
    }

    return DEFAULT_RETRY_MULTIPLIER;
  }

  private async captureAvailableModels(response: FetchResponse): Promise<void> {
    try {
      const payload = (await response.json()) as { models?: Array<{ name?: unknown }> };
      if (!payload || !Array.isArray(payload.models)) {
        return;
      }

      const names = payload.models
        .map((entry) => (typeof entry?.name === "string" ? entry.name.trim() : ""))
        .filter((name): name is string => name.length > 0);

      if (names.length > 0) {
        this.availableModels = names;
      }
    } catch {
      // Ignore parse errors; availability improvements are best-effort.
    }
  }

  private selectInstalledModel(preferred: string): string {
    if (!this.availableModels?.length) {
      return preferred;
    }

    if (this.availableModels.includes(preferred)) {
      return preferred;
    }

    const cached = this.resolvedModelCache.get(preferred);
    if (cached) {
      return cached;
    }

    const targetPrefix = this.extractModelPrefix(preferred);
    const fallback = this.availableModels.find((model) => this.extractModelPrefix(model) === targetPrefix);

    if (fallback) {
      this.resolvedModelCache.set(preferred, fallback);
      return fallback;
    }

    return preferred;
  }

  private extractModelPrefix(model: string): string {
    const separatorIndex = model.indexOf(":");
    if (separatorIndex === -1) {
      return model;
    }
    return model.slice(0, separatorIndex);
  }

  private joinUrl(path: string): string {
    return `${this.baseUrl.replace(/\/$/, "")}${path}`;
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    options: { signal?: AbortSignal } = {},
  ): Promise<T> {
    let attempt = 0;
    let delay = this.retryDelayMs;

    // Attempt loop with exponential backoff for transient failures.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (options.signal?.aborted) {
        throw this.toAbortError(options.signal);
      }

      try {
        return await operation();
      } catch (error) {
        const retryable = this.shouldRetry(error);

        if (!retryable) {
          throw error instanceof Error ? error : new Error(String(error));
        }

        if (attempt >= this.maxRetries) {
          const cause = error instanceof Error ? error : new Error(String(error));
          throw new OllamaUnavailableError(
            `Failed to communicate with Ollama after ${attempt + 1} attempt(s): ${cause.message}`,
            { cause, attempts: attempt + 1 },
          );
        }

        attempt += 1;
        await this.sleep(delay, options.signal);
        delay *= this.retryMultiplier;
      }
    }
  }

  private shouldRetry(error: unknown): boolean {
    if (error instanceof OllamaTimeoutError) {
      return true;
    }

    if (error instanceof OllamaRequestError) {
      return error.status >= 500 || error.status === 429;
    }

    if (error instanceof OllamaUnavailableError) {
      return true;
    }

    if (error instanceof TypeError) {
      return true;
    }

    return false;
  }

  private async sleep(delay: number, signal?: AbortSignal): Promise<void> {
    if (delay <= 0) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, delay);

      const onAbort = () => {
        cleanup();
        reject(this.toAbortError(signal!));
      };

      const cleanup = () => {
        clearTimeout(timer);
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
      };

      if (signal) {
        if (signal.aborted) {
          cleanup();
          reject(this.toAbortError(signal));
          return;
        }

        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  private toAbortError(signal: AbortSignal): Error {
    const reason = signal.reason;

    if (reason instanceof Error) {
      return reason;
    }

    if (typeof reason === "string") {
      const abortError = new Error(reason);
      abortError.name = "AbortError";
      return abortError;
    }

    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    return abortError;
  }

  private async performFetch(path: string, init: FetchInit, signal?: AbortSignal): Promise<FetchResponse> {
    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;

    if (signal) {
      if (signal.aborted) {
        throw this.toAbortError(signal);
      }

      onAbort = () => {
        controller.abort(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }

    if (this.timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        controller.abort(new OllamaTimeoutError(`Request to ${path} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
    }

    try {
      const response = await this.fetcher(this.joinUrl(path), {
        ...init,
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if (controller.signal.aborted) {
        const reason = controller.signal.reason;

        if (reason instanceof Error) {
          throw reason;
        }

        if (typeof reason === "string") {
          const abortError = new Error(reason);
          abortError.name = "AbortError";
          throw abortError;
        }

        const abortError = new Error("The request was aborted");
        abortError.name = "AbortError";
        throw abortError;
      }

      throw error;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
    }
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

  private isGracefulFailure(error: unknown): boolean {
    if (error instanceof OllamaUnavailableError || error instanceof OllamaTimeoutError) {
      return true;
    }

    if (error instanceof OllamaRequestError) {
      return error.status >= 500 || error.status === 429;
    }

    return false;
  }

  private createFallbackAnalysis(error: unknown): AnalysisResult {
    const message = error instanceof Error ? error.message : "Ollama is unavailable";
    return {
      relevant: false,
      confidence: 0,
      reason: message,
      tags: undefined,
      rawResponse: "",
    };
  }
}

export function createOllamaClient(options?: OllamaClientOptions): OllamaClient {
  return new OllamaClient(options);
}
