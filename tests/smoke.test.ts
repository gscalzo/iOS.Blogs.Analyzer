import { beforeEach, describe, expect, it, vi } from "vitest";
import { main, parseArguments } from "../src/index.js";
import type { BlogsDirectory } from "../src/types.js";
import { extractFeedUrls, loadBlogs } from "../src/blogs.js";
import { analyzeFeeds, DEFAULT_PARALLEL } from "../src/analyzer.js";

vi.mock("../src/blogs.js");
vi.mock("../src/analyzer.js");

const mockedLoadBlogs = vi.mocked(loadBlogs);
const mockedExtractFeedUrls = vi.mocked(extractFeedUrls);
const mockedAnalyzeFeeds = vi.mocked(analyzeFeeds);

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

  it("marks help flag", () => {
    expect(parseArguments(["--help"])).toEqual({ helpRequested: true });
  });

  it("throws on unknown flags", () => {
    expect(() => parseArguments(["--unknown"])).toThrow(/Unknown argument/);
  });

  it("rejects invalid --parallel values", () => {
    expect(() => parseArguments(["--parallel", "0"])).toThrow(/--parallel must be a positive integer/);
  });
});

describe("main", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.exitCode = 0;
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
      });
      return [
        {
          feedUrl: "https://example.com/feed",
          status: "fulfilled",
          feed: { title: "Example", items: [] },
        },
      ];
    });

    const stdout = createWriter();
    const stderr = createWriter();

    await main({ argv: [], stdout: stdout.writer, stderr: stderr.writer });

    expect(mockedLoadBlogs).toHaveBeenCalledTimes(1);
    expect(mockedExtractFeedUrls).toHaveBeenCalledWith(sampleBlogs, { maxBlogs: undefined });
    expect(mockedAnalyzeFeeds).toHaveBeenCalledWith(
      ["https://example.com/feed"],
      expect.objectContaining({ parallel: DEFAULT_PARALLEL }),
    );
    const stdoutText = stdout.messages.join("");
    expect(stdoutText).toContain("Loaded 1 feed URLs.");
    expect(stdoutText).toMatch(/\[1\/1\] OK https:\/\/example.com\/feed/);
    expect(stdoutText).toMatch(/Finished 1 feeds: 1 succeeded, 0 failed/);
    expect(stderr.messages).toHaveLength(0);
    expect(process.exitCode).toBe(0);
  });

  it("respects --max-blogs argument", async () => {
    mockedLoadBlogs.mockResolvedValue(sampleBlogs);
    mockedExtractFeedUrls.mockReturnValue(["https://example.com/feed"]);
    mockedAnalyzeFeeds.mockResolvedValue([
      { feedUrl: "https://example.com/feed", status: "fulfilled", feed: { title: "Example", items: [] } },
    ]);

    const stdout = createWriter();
    const stderr = createWriter();

    await main({ argv: ["--max-blogs", "1"], stdout: stdout.writer, stderr: stderr.writer });

    expect(mockedExtractFeedUrls).toHaveBeenCalledWith(sampleBlogs, { maxBlogs: 1 });
    expect(mockedAnalyzeFeeds).toHaveBeenCalled();
  });

  it("reports invalid --max-blogs values", async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    await main({ argv: ["--max-blogs", "nope"], stdout: stdout.writer, stderr: stderr.writer });

    expect(mockedLoadBlogs).not.toHaveBeenCalled();
    expect(mockedExtractFeedUrls).not.toHaveBeenCalled();
    expect(stderr.messages.join("")).toMatch(/--max-blogs must be a non-negative integer/);
    expect(process.exitCode).toBe(1);
  });

  it("allows overriding parallelism", async () => {
    mockedLoadBlogs.mockResolvedValue(sampleBlogs);
    mockedExtractFeedUrls.mockReturnValue(["https://example.com/feed"]);
    mockedAnalyzeFeeds.mockResolvedValue([
      { feedUrl: "https://example.com/feed", status: "fulfilled", feed: { title: "Example", items: [] } },
    ]);

    const stdout = createWriter();
    const stderr = createWriter();

    await main({ argv: ["--parallel", "5"], stdout: stdout.writer, stderr: stderr.writer });

    expect(mockedAnalyzeFeeds).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ parallel: 5 }),
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
      });
      return [
        { feedUrl: "https://example.com/feed", status: "rejected", error },
      ];
    });

    const stdout = createWriter();
    const stderr = createWriter();

    await main({ stdout: stdout.writer, stderr: stderr.writer });

    expect(stdout.messages.join("")).toMatch(/Finished 1 feeds: 0 succeeded, 1 failed/);
    expect(stderr.messages.join("")).toContain("boom");
    expect(process.exitCode).toBe(1);
  });

  it("short-circuits when no feeds are available", async () => {
    mockedLoadBlogs.mockResolvedValue(sampleBlogs);
    mockedExtractFeedUrls.mockReturnValue([]);

    const stdout = createWriter();
    const stderr = createWriter();

    await main({ stdout: stdout.writer, stderr: stderr.writer });

    expect(stdout.messages.join("")).toContain("No feeds to process");
    expect(mockedAnalyzeFeeds).not.toHaveBeenCalled();
  });

  it("shows help when requested", async () => {
    const stdout = createWriter();

    await main({ argv: ["--help"], stdout: stdout.writer });

    expect(stdout.messages.join("")).toMatch(/Usage/);
    expect(mockedLoadBlogs).not.toHaveBeenCalled();
  });
});