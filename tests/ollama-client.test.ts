import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OllamaClient,
  OllamaConfigurationError,
  OllamaRequestError,
  OllamaParseError,
  OllamaTimeoutError,
  OllamaUnavailableError,
  type FetchInit,
  type FetchResponse,
} from "../src/ollama-client.js";

function createMockFetcher(
  implementation: (input: string, init?: FetchInit) => Promise<FetchResponse>,
) {
  const mock = vi.fn<[string, FetchInit?], Promise<FetchResponse>>(implementation);
  return {
    mock,
    fetcher: mock as unknown as (input: string, init?: FetchInit) => Promise<FetchResponse>,
  } as const;
}

function createJsonResponse(body: unknown, overrides: Partial<FetchResponse> = {}): FetchResponse {
  return {
    ok: overrides.ok ?? true,
    status: overrides.status ?? (overrides.ok === false ? 500 : 200),
    statusText: overrides.statusText ?? "OK",
    json: overrides.json ?? (async () => body),
    text:
      overrides.text ??
      (async () => (typeof body === "string" ? body : JSON.stringify(body))),
  } satisfies FetchResponse;
}

describe("OllamaClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("checks connectivity via /api/tags", async () => {
    const { mock, fetcher } = createMockFetcher(async () => createJsonResponse({ models: [] }));
    const client = new OllamaClient({ fetcher, model: "llama3.1" });

    await expect(client.checkConnection()).resolves.toBe(true);

    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:11434/api/tags");
    expect(init?.method).toBe("GET");
  });

  it("selects an installed tag variant for the default model after connectivity check", async () => {
    const fetcher = vi.fn<[string, FetchInit?], Promise<FetchResponse>>(async (url) => {
      if (url.endsWith("/api/tags")) {
        return createJsonResponse({ models: [{ name: "llama3.1:8b" }] });
      }
      return createJsonResponse({ response: JSON.stringify({ relevant: false }) });
    });
    const client = new OllamaClient({ fetcher, model: "llama3.1" });

    await client.checkConnection();
    await client.analyzeText("Discusses Core ML");

    const generateCall = fetcher.mock.calls.find(([calledUrl]) => calledUrl.endsWith("/api/generate"));
    expect(generateCall).toBeDefined();
    const [, generateInit] = generateCall ?? [];
    const payload = JSON.parse(generateInit?.body ?? "{}");
    expect(payload.model).toBe("llama3.1:8b");
  });

  it("throws when connectivity check fails", async () => {
    const { mock, fetcher } = createMockFetcher(async () =>
      createJsonResponse(
        { error: "not found" },
        {
          ok: false,
          status: 404,
          statusText: "Not Found",
          text: async () => "model not loaded",
        },
      ),
    );
    const client = new OllamaClient({ fetcher, model: "llama3.1" });

    await expect(client.checkConnection()).rejects.toThrowError(OllamaRequestError);
  });

  it("posts description for analysis and returns boolean decision", async () => {
    const { mock, fetcher } = createMockFetcher(async () =>
      createJsonResponse({
        response: JSON.stringify({ relevant: true, confidence: 0.82, reason: "Focuses on Core ML", tags: ["ios"] }),
      }),
    );
    const client = new OllamaClient({ fetcher, model: "llama3.1" });

    const result = await client.analyzeText("Discusses Core ML advancements");

    expect(result).toBe(true);
    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:11434/api/generate");
    expect(init?.method).toBe("POST");

    const parsedBody = JSON.parse(init?.body ?? "{}");
    expect(parsedBody.model).toBe("llama3.1");
    expect(parsedBody.prompt).toMatch(/Core ML advancements/);
    expect(parsedBody.prompt).toMatch(/Respond with a JSON object/);
    expect(parsedBody.prompt).toMatch(/developer-focused AI topics/i);
    expect(parsedBody.stream).toBe(false);
  });

  it("accepts explicitly tagged model overrides", async () => {
    const { mock, fetcher } = createMockFetcher(async () =>
      createJsonResponse({ response: JSON.stringify({ relevant: false, reason: "Not AI" }) }),
    );
    const client = new OllamaClient({ fetcher, model: "llama3.1:8b" });

    await client.analyzeText("Some description");

    const [, init] = mock.mock.calls[0];
    const parsedBody = JSON.parse(init?.body ?? "{}");
    expect(parsedBody.model).toBe("llama3.1:8b");
  });

  it("accepts arbitrary model names and uses them when installed", async () => {
    const fetcher = vi.fn<[string, FetchInit?], Promise<FetchResponse>>(async (url) => {
      if (url.endsWith("/api/tags")) {
        return createJsonResponse({ models: [{ name: "deepseek-r1:8b" }] });
      }
      return createJsonResponse({ response: JSON.stringify({ relevant: false, reason: "irrelevant" }) });
    });
    const client = new OllamaClient({ fetcher, model: "deepseek-r1:8b" });

    await client.checkConnection();
    await client.analyzeText("Some description");

    const generateCall = fetcher.mock.calls.find(([calledUrl]) => calledUrl.endsWith("/api/generate"));
    expect(generateCall).toBeDefined();
    const [, init] = generateCall ?? [];
    const payload = JSON.parse(init?.body ?? "{}");
    expect(payload.model).toBe("deepseek-r1:8b");
  });

  it("returns structured analysis details", async () => {
    const payload = {
      relevant: true,
      confidence: 0.9,
      reason: "Highlights Core ML integration into an iOS app",
      tags: ["ios", "coreml", "ai"],
    };
    const { fetcher } = createMockFetcher(async () =>
      createJsonResponse({ response: JSON.stringify(payload) }),
    );
    const client = new OllamaClient({ fetcher, model: "llama3.1" });

    const analysis = await client.analyze("New Core ML model for SwiftUI widgets");

    expect(analysis.relevant).toBe(true);
    expect(analysis.confidence).toBeCloseTo(0.9);
    expect(analysis.reason).toMatch(/Core ML integration/);
    expect(analysis.tags).toEqual(["ios", "coreml", "ai"]);
    expect(analysis.rawResponse).toContain("Core ML");
  });

  it("parses negative decisions", async () => {
    const { fetcher } = createMockFetcher(async () =>
      createJsonResponse({ response: JSON.stringify({ relevant: false, reason: "It is about marketing" }) }),
    );
    const client = new OllamaClient({ fetcher, model: "llama3.1" });

    const result = await client.analyze("Marketing strategies for app launch");

    expect(result.relevant).toBe(false);
    expect(result.reason).toMatch(/marketing/);
  });

  it("falls back to yes/no strings when JSON is missing", async () => {
    const { fetcher } = createMockFetcher(async () => createJsonResponse({ response: "YES definitely" }));
    const client = new OllamaClient({ fetcher, model: "llama3.1" });

    const result = await client.analyze("Mentions Swift, Core ML, and on-device vision");

    expect(result.relevant).toBe(true);
    expect(result.rawResponse).toContain("YES definitely");
    expect(result.reason).toBeUndefined();
  });

  it("throws when no decision can be parsed", async () => {
    const { fetcher } = createMockFetcher(async () => createJsonResponse({ response: "Maybe?" }));
    const client = new OllamaClient({ fetcher, model: "llama3.1" });

    await expect(client.analyze("Ambiguous content")).rejects.toThrowError(OllamaParseError);
  });

  it("retries transient failures and eventually succeeds", async () => {
    const failures = [new TypeError("network down"), new TypeError("still down")];
    const fetcher = vi.fn<[string, FetchInit?], Promise<FetchResponse>>(async () => {
      const failure = failures.shift();
      if (failure) {
        throw failure;
      }

      return createJsonResponse({
        response: JSON.stringify({ relevant: true, confidence: 0.7, reason: "Mentions Core ML" }),
      });
    });

    const client = new OllamaClient({ fetcher, model: "llama3.1" });
    const result = await client.analyzeText("Discusses Vision Pro with Core ML");

    expect(result).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("halts on non-retriable errors", async () => {
    const { mock, fetcher } = createMockFetcher(async () =>
      createJsonResponse(
        { error: "bad request" },
        {
          ok: false,
          status: 400,
          statusText: "Bad Request",
          text: async () => "invalid payload",
        },
      ),
    );

    const client = new OllamaClient({ fetcher, model: "llama3.1" });

    await expect(client.analyze("bad input"))
      .rejects.toThrowError(new OllamaRequestError("", 400).constructor);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("throws OllamaUnavailableError after exceeding retries", async () => {
    const fetcher = vi.fn<[string, FetchInit?], Promise<FetchResponse>>(async () => {
      throw new TypeError("connection refused");
    });

    const client = new OllamaClient({ fetcher, maxRetries: 1, retryDelayMs: 0, model: "llama3.1" });

    await expect(client.analyze("No network"))
      .rejects.toThrowError(OllamaUnavailableError);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("supports graceful degradation when configured", async () => {
    const fetcher = vi.fn<[string, FetchInit?], Promise<FetchResponse>>(async () => {
      throw new TypeError("no route to host");
    });

    const client = new OllamaClient({ fetcher, maxRetries: 0, model: "llama3.1" });
    const analysis = await client.analyze("Offline scenario", { gracefulDegradation: true });

    expect(analysis.relevant).toBe(false);
    expect(analysis.confidence).toBe(0);
    expect(analysis.reason).toMatch(/Failed to communicate/i);
    expect(analysis.rawResponse).toBe("");
  });

  it("honours request timeout", async () => {
    const fetcher = vi.fn<[string, FetchInit?], Promise<FetchResponse>>(
      async (_url, init) =>
        new Promise<FetchResponse>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              const reason = init.signal?.reason;
              reject(reason instanceof Error ? reason : new OllamaTimeoutError("aborted"));
            },
            { once: true },
          );
        }),
    );

    const client = new OllamaClient({ fetcher, timeoutMs: 5, maxRetries: 0, model: "llama3.1" });
    const promise = client.analyze("long running");

    await expect(promise).rejects.toThrowError(OllamaUnavailableError);
    await promise.catch((error) => {
      const cause = (error as Error & { cause?: unknown }).cause;
      expect(cause).toBeInstanceOf(OllamaTimeoutError);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
