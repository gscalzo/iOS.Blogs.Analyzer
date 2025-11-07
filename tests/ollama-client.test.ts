import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OllamaClient,
  OllamaConfigurationError,
  OllamaRequestError,
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
    const { mock, fetcher } = createMockFetcher(async () => createJsonResponse({ response: "YES" }));
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
    expect(parsedBody.stream).toBe(false);
  });

  it("uses model override from environment", async () => {
    process.env.IOS_BLOGS_ANALYZER_MODEL = "qwq";
    const { mock, fetcher } = createMockFetcher(async () => createJsonResponse({ response: "NO" }));

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
        fetcher: createMockFetcher(async () => createJsonResponse({ response: "NO" })).fetcher,
      }),
    ).toThrowError(OllamaConfigurationError);
  });
});
