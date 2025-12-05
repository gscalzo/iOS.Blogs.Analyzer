import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { main, parseArguments } from "../src/index.js";
import type { BlogsDirectory } from "../src/types.js";
import { extractFeedUrls, loadBlogs } from "../src/blogs.js";
import { analyzeFeeds, DEFAULT_MONTH_WINDOW, DEFAULT_PARALLEL } from "../src/analyzer.js";
import { loadFilterConfig } from "../src/config.js";

const { ollamaFactory } = vi.hoisted(() => ({
  ollamaFactory: {
    createInstance: () => ({
      checkConnection: vi.fn().mockResolvedValue(true),
      analyze: vi.fn().mockResolvedValue({ relevant: false, rawResponse: "{}" }),
    }),
  },
}));

vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/blogs.js");
vi.mock("../src/analyzer.js");
vi.mock("../src/ollama-client.js", () => ({
  OllamaClient: vi.fn(() => ollamaFactory.createInstance()),
}));
vi.mock("../src/config.js");

const mockedWriteFile = vi.mocked(writeFile);

const mockedLoadBlogs = vi.mocked(loadBlogs);
const mockedExtractFeedUrls = vi.mocked(extractFeedUrls);
const mockedAnalyzeFeeds = vi.mocked(analyzeFeeds);
const mockedLoadFilterConfig = vi.mocked(loadFilterConfig);

function createWriter() {
  const messages: string[] = [];
  return {
    writer: {
      write(message: string) {
        messages.push(message);
        return message.length;
      },
    },
    messages,
  } as const;
}

const sampleBlogs: BlogsDirectory = [
  {
    language: "en",
    title: "Sample",
    categories: [
      {
        title: "General",
        slug: "general",
        description: "General",
        sites: [
          {
            title: "Site",
            author: "Author",
            site_url: "https://example.com",
            feed_url: "https://example.com/feed",
          },
        ],
      },
    ],
  },
];

describe("parseArguments", () => {
  it("parses --max-blogs when provided", () => {
    expect(parseArguments(["--max-blogs", "2"])).toEqual({ maxBlogs: 2 });
  });

  it("parses --parallel when provided", () => {
    expect(parseArguments(["--parallel", "4"])).toEqual({ parallel: 4 });
  });

  it("parses model and trims value", () => {
    expect(parseArguments(["--model", " qwq "])).toEqual({ model: "qwq" });
  });

  it("parses output and verbose flags", () => {
    expect(parseArguments(["--output", "results.json", "--verbose"])).toEqual({
      output: { format: "json", destination: "results.json" },
      verbose: true,
    });
  });

  it("parses output format when prefixed", () => {
    expect(parseArguments(["--output", "csv:reports.csv"])).toEqual({
      output: { format: "csv", destination: "reports.csv" },
    });
  });

  it("supports stdout CSV selection via --output csv", () => {
    expect(parseArguments(["--output", "csv"])).toEqual({
      output: { format: "csv", destination: undefined },
    });
  });

  it("supports -v alias for verbose logging", () => {
    expect(parseArguments(["-v"])).toEqual({ verbose: true });
  });

  it("parses --months when provided", () => {
    expect(parseArguments(["--months", "6"])).toEqual({ months: 6 });
  });

  it("marks help flag", () => {
    expect(parseArguments(["--help"])).toEqual({ helpRequested: true });
  });

  it("throws on unknown flags", () => {
    expect(() => parseArguments(["--unknown"])).toThrow(/Unknown/);
  });

  it("rejects invalid --parallel values", () => {
    expect(() => parseArguments(["--parallel", "0"])).toThrow(/--parallel must be a positive integer/);
  });

  it("rejects empty model values", () => {
    expect(() => parseArguments(["--model", " "])).toThrow(/--model must be a non-empty string/);
  });

  it("rejects empty output values", () => {
    expect(() => parseArguments(["--output", " "])).toThrow(/--output must be a non-empty string/);
  });

  it("rejects unsupported output formats", () => {
    expect(() => parseArguments(["--output", "xml:report.xml"])).toThrow(/--output format must be one of/);
  });

  it("rejects invalid --months values", () => {
    expect(() => parseArguments(["--months", "0"])).toThrow(/--months must be a positive integer/);
  });
});

describe("main", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.exitCode = 0;
    mockedWriteFile.mockReset();
    mockedLoadFilterConfig.mockResolvedValue({ allowedLanguages: ["en"], allowedCategories: undefined });
    ollamaFactory.createInstance = () => ({
      checkConnection: vi.fn().mockResolvedValue(true),
      analyze: vi.fn().mockResolvedValue({ relevant: false, rawResponse: "{}" }),
    });
  });

  it("loads blogs, processes feeds, and prints progress", async () => {
    mockedLoadBlogs.mockResolvedValue(sampleBlogs);
    mockedExtractFeedUrls.mockReturnValue(["https://example.com/feed"]);
    mockedAnalyzeFeeds.mockImplementation(async (_feeds, options) => {
      options?.onProgress?.({
        feedUrl: "https://example.com/feed",
        completed: 1,
        total: 1,
        status: "fulfilled",
        durationMs: 1200,
      });
      return [
        {
          feedUrl: "https://example.com/feed",
          status: "fulfilled",
          feed: { title: "Example", items: [] },
          durationMs: 1200,
          relevantPosts: [
            {
              title: "AI in iOS",
              link: "https://example.com/post",
              publishedAt: "2025-11-01T00:00:00.000Z",
              analysis: { relevant: true, rawResponse: "{}", reason: "Matches keywords" },
            },
          ],
        },
      ];
    });

    const stdout = createWriter();
    const stderr = createWriter();

    let currentTime = 0;
    const now = () => currentTime;

    await main({ argv: [], stdout: stdout.writer, stderr: stderr.writer, now, env: {} });

    expect(mockedLoadBlogs).toHaveBeenCalledTimes(1);
    expect(mockedExtractFeedUrls).toHaveBeenCalledWith(sampleBlogs, {
      maxBlogs: undefined,
      languages: ["en"],
      categories: undefined,
    });
    expect(mockedAnalyzeFeeds).toHaveBeenCalledWith(
      ["https://example.com/feed"],
      expect.objectContaining({
        parallel: DEFAULT_PARALLEL,
        months: DEFAULT_MONTH_WINDOW,
        dependencies: expect.objectContaining({ analysisClient: expect.any(Object) }),
      }),
    );
    const stdoutText = stdout.messages.join("");
    expect(stdoutText).toContain("Loaded 1 feed URLs (languages: en; categories: all categories).");
    expect(stdoutText).toMatch(/\[1\/1\] OK https:\/\/example.com\/feed/);
    expect(stdoutText).toMatch(/Finished 1 feeds: 1 succeeded, 0 failed in 00:00 avg 1.2s/);
    expect(stdoutText).toContain('"feeds"');
    expect(stdoutText).toContain('"AI in iOS"');
    expect(stderr.messages).toHaveLength(0);
    expect(process.exitCode).toBe(0);
    expect(mockedWriteFile).not.toHaveBeenCalled();
  });

  it("respects --max-blogs argument", async () => {
    mockedLoadBlogs.mockResolvedValue(sampleBlogs);
    mockedExtractFeedUrls.mockReturnValue(["https://example.com/feed"]);
    mockedAnalyzeFeeds.mockResolvedValue([
      { feedUrl: "https://example.com/feed", status: "fulfilled", feed: { title: "Example", items: [] }, durationMs: 500 },
    ]);

    const stdout = createWriter();
    const stderr = createWriter();

    await main({ argv: ["--max-blogs", "1"], stdout: stdout.writer, stderr: stderr.writer, env: {} });

    expect(mockedExtractFeedUrls).toHaveBeenCalledWith(sampleBlogs, {
      maxBlogs: 1,
      languages: ["en"],
      categories: undefined,
    });
    expect(mockedAnalyzeFeeds).toHaveBeenCalled();
  });

  it("reports invalid --max-blogs values", async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    await main({ argv: ["--max-blogs", "nope"], stdout: stdout.writer, stderr: stderr.writer, env: {} });

    expect(mockedLoadBlogs).not.toHaveBeenCalled();
    expect(mockedExtractFeedUrls).not.toHaveBeenCalled();
    expect(stderr.messages.join("")).toMatch(/--max-blogs must be a non-negative integer/);
    expect(process.exitCode).toBe(1);
  });

  it("allows overriding parallelism", async () => {
    mockedLoadBlogs.mockResolvedValue(sampleBlogs);
    mockedExtractFeedUrls.mockReturnValue(["https://example.com/feed"]);
    mockedAnalyzeFeeds.mockResolvedValue([
      { feedUrl: "https://example.com/feed", status: "fulfilled", feed: { title: "Example", items: [] }, durationMs: 400 },
    ]);

    const stdout = createWriter();
    const stderr = createWriter();

    await main({ argv: ["--parallel", "5"], stdout: stdout.writer, stderr: stderr.writer, now: () => 0, env: {} });

    expect(mockedAnalyzeFeeds).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ parallel: 5 }),
    );
  });

  it("passes months argument through to analyzer", async () => {
    mockedLoadBlogs.mockResolvedValue(sampleBlogs);
    mockedExtractFeedUrls.mockReturnValue(["https://example.com/feed"]);
    mockedAnalyzeFeeds.mockResolvedValue([
      { feedUrl: "https://example.com/feed", status: "fulfilled", feed: { title: "Example", items: [] }, durationMs: 400 },
    ]);

    const stdout = createWriter();
    const stderr = createWriter();

    await main({ argv: ["--months", "2"], stdout: stdout.writer, stderr: stderr.writer, env: {} });

    expect(mockedAnalyzeFeeds).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ months: 2 }),
    );
  });

  it("prints failures and sets exit code", async () => {
    mockedLoadBlogs.mockResolvedValue(sampleBlogs);
    mockedExtractFeedUrls.mockReturnValue(["https://example.com/feed"]);
    mockedAnalyzeFeeds.mockImplementation(async (_feeds, options) => {
      const error = new Error("boom");
      options?.onProgress?.({
        feedUrl: "https://example.com/feed",
        completed: 1,
        total: 1,
        status: "rejected",
        error,
        durationMs: 0,
      });
      return [
        { feedUrl: "https://example.com/feed", status: "rejected", error, durationMs: 0 },
      ];
    });

    const stdout = createWriter();
    const stderr = createWriter();

    await main({ stdout: stdout.writer, stderr: stderr.writer, now: () => 0, env: {} });

    expect(stdout.messages.join("")).toMatch(/Finished 1 feeds: 0 succeeded, 1 failed/);
    expect(stderr.messages.join("")).toContain("boom");
    expect(process.exitCode).toBe(1);
  });

  it("short-circuits when no feeds are available", async () => {
    mockedLoadBlogs.mockResolvedValue(sampleBlogs);
    mockedExtractFeedUrls.mockReturnValue([]);

    const stdout = createWriter();
    const stderr = createWriter();

    await main({ stdout: stdout.writer, stderr: stderr.writer, env: {} });

    expect(stdout.messages.join("")).toContain("No feeds to process");
    expect(mockedAnalyzeFeeds).not.toHaveBeenCalled();
  });

  it("fails fast when Ollama connection is unavailable", async () => {
    ollamaFactory.createInstance = () => ({
      checkConnection: vi.fn().mockRejectedValue(new Error("offline")),
      analyze: vi.fn().mockResolvedValue({ relevant: false, rawResponse: "{}" }),
    });

    const stdout = createWriter();
    const stderr = createWriter();

    await main({ stdout: stdout.writer, stderr: stderr.writer, env: {} });

    expect(stderr.messages.join("")).toContain("offline");
    expect(mockedLoadBlogs).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("shows help when requested", async () => {
    const stdout = createWriter();

    await main({ argv: ["--help"], stdout: stdout.writer, env: {} });

    expect(stdout.messages.join("")).toMatch(/Usage/);
    expect(mockedLoadBlogs).not.toHaveBeenCalled();
  });

  it("overrides Ollama model via CLI", async () => {
    mockedLoadBlogs.mockResolvedValue(sampleBlogs);
    mockedExtractFeedUrls.mockReturnValue(["https://example.com/feed"]);
    mockedAnalyzeFeeds.mockResolvedValue([
      { feedUrl: "https://example.com/feed", status: "fulfilled", feed: { title: "Example", items: [] }, durationMs: 400 },
    ]);

    const stdout = createWriter();
    const env: NodeJS.ProcessEnv = {};

    await main({ argv: ["--model", "qwq"], stdout: stdout.writer, stderr: createWriter().writer, env });

    expect(env.IOS_BLOGS_ANALYZER_MODEL).toBe("qwq");
  });

  it("passes verbose logging callback when --verbose is provided", async () => {
    mockedLoadBlogs.mockResolvedValue(sampleBlogs);
    mockedExtractFeedUrls.mockReturnValue(["https://example.com/feed"]);
    mockedAnalyzeFeeds.mockResolvedValue([
      { feedUrl: "https://example.com/feed", status: "fulfilled", feed: { title: "Example", items: [] }, durationMs: 400 },
    ]);

    const stdout = createWriter();
    const stderr = createWriter();

    await main({ argv: ["--verbose"], stdout: stdout.writer, stderr: stderr.writer, env: {} });

    expect(mockedAnalyzeFeeds).toHaveBeenCalledWith(
      ["https://example.com/feed"],
      expect.objectContaining({
        onVerboseMessage: expect.any(Function),
      }),
    );
  });

  it("writes JSON output to a file when --output is provided", async () => {
    mockedLoadBlogs.mockResolvedValue(sampleBlogs);
    mockedExtractFeedUrls.mockReturnValue(["https://example.com/feed"]);
    mockedAnalyzeFeeds.mockResolvedValue([
      {
        feedUrl: "https://example.com/feed",
        status: "fulfilled",
        feed: { title: "Example", items: [] },
        durationMs: 400,
        relevantPosts: [
          {
            title: "AI in iOS",
            link: "https://example.com/post",
            analysis: { relevant: true, rawResponse: "{}" },
          },
        ],
      },
    ]);

    const stdout = createWriter();
    const stderr = createWriter();

    await main({ argv: ["--output", "results.json"], stdout: stdout.writer, stderr: stderr.writer, env: {} });

    expect(mockedWriteFile).toHaveBeenCalledWith("results.json", expect.stringContaining('"feeds"'), "utf8");
    expect(stdout.messages.join("")).toContain("Results written to results.json");
  });

  it("writes CSV output to a file when --output csv:<path> is provided", async () => {
    mockedLoadBlogs.mockResolvedValue(sampleBlogs);
    mockedExtractFeedUrls.mockReturnValue(["https://example.com/feed"]);
    mockedAnalyzeFeeds.mockResolvedValue([
      {
        feedUrl: "https://example.com/feed",
        status: "fulfilled",
        feed: { title: "Example", items: [] },
        durationMs: 400,
        relevantPosts: [
          {
            title: "AI in iOS",
            link: "https://example.com/post",
            publishedAt: "2025-11-01T00:00:00.000Z",
            analysis: {
              relevant: true,
              rawResponse: "{}",
              reason: "Matches keywords, including frameworks",
              confidence: 0.92,
              tags: ["ai", "ios"],
            },
          },
        ],
      },
    ]);

    const stdout = createWriter();
    const stderr = createWriter();

    await main({ argv: ["--output", "csv:results.csv"], stdout: stdout.writer, stderr: stderr.writer, env: {} });

    expect(mockedWriteFile).toHaveBeenCalledTimes(1);
    const csvPayload = mockedWriteFile.mock.calls[0][1];
    expect(csvPayload).toContain("feed_title,feed_url,post_title,post_link,published_at,confidence,tags,reason");
    expect(csvPayload).toMatch(/Example,https:\/\/example\.com\/feed,AI in iOS,https:\/\/example\.com\/post,2025-11-01T00:00:00.000Z,0.92,ai;ios,"Matches keywords, including frameworks"/);
    expect(stdout.messages.join("")).toContain("Results written to results.csv");
  });

  it("writes CSV to stdout when --output csv is provided without a file", async () => {
    mockedLoadBlogs.mockResolvedValue(sampleBlogs);
    mockedExtractFeedUrls.mockReturnValue(["https://example.com/feed"]);
    mockedAnalyzeFeeds.mockResolvedValue([
      {
        feedUrl: "https://example.com/feed",
        status: "fulfilled",
        feed: { title: "Example", items: [] },
        durationMs: 400,
        relevantPosts: [
          {
            title: "AI in iOS",
            link: "https://example.com/post",
            publishedAt: "2025-11-01T00:00:00.000Z",
            analysis: {
              relevant: true,
              rawResponse: "{}",
              reason: "Matches keywords",
              confidence: 0.87,
            },
          },
        ],
      },
    ]);

    const stdout = createWriter();
    const stderr = createWriter();

    await main({ argv: ["--output", "csv"], stdout: stdout.writer, stderr: stderr.writer, env: {} });

    expect(mockedWriteFile).not.toHaveBeenCalled();
    const stdoutText = stdout.messages.join("");
    expect(stdoutText).toContain("feed_title,feed_url,post_title,post_link,published_at,confidence,tags,reason");
    expect(stdoutText).toContain("Example,https://example.com/feed,AI in iOS,https://example.com/post,2025-11-01T00:00:00.000Z,0.87,,Matches keywords");
  });
});
