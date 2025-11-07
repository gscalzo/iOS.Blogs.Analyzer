import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OllamaClient,
  OllamaConfigurationError,
  OllamaRequestError,
  OllamaParseError,
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
    delete process.env.IOS_BLOGS_ANALYZER_MODEL;
  });

  it("checks connectivity via /api/tags", async () => {
    const { mock, fetcher } = createMockFetcher(async () => createJsonResponse({ models: [] }));
    const client = new OllamaClient({ fetcher });

    await expect(client.checkConnection()).resolves.toBe(true);

    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:11434/api/tags");
    expect(init?.method).toBe("GET");
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
    const client = new OllamaClient({ fetcher });

    await expect(client.checkConnection()).rejects.toThrowError(OllamaRequestError);
  });

  it("posts description for analysis and returns boolean decision", async () => {
    const { mock, fetcher } = createMockFetcher(async () =>
      createJsonResponse({
        response: JSON.stringify({ relevant: true, confidence: 0.82, reason: "Focuses on Core ML", tags: ["ios"] }),
      }),
    );
    const client = new OllamaClient({ fetcher });

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
    expect(parsedBody.stream).toBe(false);
  });

  it("uses model override from environment", async () => {
    process.env.IOS_BLOGS_ANALYZER_MODEL = "qwq";
    const { mock, fetcher } = createMockFetcher(async () =>
      createJsonResponse({ response: JSON.stringify({ relevant: false, reason: "No mobile content" }) }),
    );

    const client = new OllamaClient({ fetcher });
    await client.analyzeText("Some description");

    const [, init] = mock.mock.calls[0];
    const parsedBody = JSON.parse(init?.body ?? "{}");
    expect(parsedBody.model).toBe("qwq");
  });

  it("rejects unsupported models", () => {
    process.env.IOS_BLOGS_ANALYZER_MODEL = "not-real";
    expect(() =>
      new OllamaClient({
        fetcher: createMockFetcher(async () =>
          createJsonResponse({ response: JSON.stringify({ relevant: false }) }),
        ).fetcher,
      }),
    ).toThrowError(OllamaConfigurationError);
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
    const client = new OllamaClient({ fetcher });

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
    const client = new OllamaClient({ fetcher });

    const result = await client.analyze("Marketing strategies for app launch");

    expect(result.relevant).toBe(false);
    expect(result.reason).toMatch(/marketing/);
  });

  it("falls back to yes/no strings when JSON is missing", async () => {
    const { fetcher } = createMockFetcher(async () => createJsonResponse({ response: "YES definitely" }));
    const client = new OllamaClient({ fetcher });

    const result = await client.analyze("Mentions Swift, Core ML, and on-device vision");

    expect(result.relevant).toBe(true);
    expect(result.rawResponse).toContain("YES definitely");
    expect(result.reason).toBeUndefined();
  });

  it("throws when no decision can be parsed", async () => {
    const { fetcher } = createMockFetcher(async () => createJsonResponse({ response: "Maybe?" }));
    const client = new OllamaClient({ fetcher });

    await expect(client.analyze("Ambiguous content")).rejects.toThrowError(OllamaParseError);
  });
});
