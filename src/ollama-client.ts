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

  async analyzeText(description: string, options: AnalyzeTextOptions = {}): Promise<boolean> {
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

    return /^yes\b/i.test(answer);
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
      "You are a classifier that decides if a blog post relates to iOS development involving AI or mobile engineering.",
      "Answer strictly with YES or NO.",
      "Blog post summary:",
      trimmed,
    ].join("\n\n");
  }
}

export function createOllamaClient(options?: OllamaClientOptions): OllamaClient {
  return new OllamaClient(options);
}