import { describe, expect, it, vi } from "vitest";
import { analyzeFeeds, type FeedAnalysisResult } from "../src/analyzer.js";
import type { AnalysisResult } from "../src/ollama-client.js";
import type { ParsedFeed } from "../src/types.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeFeed(title: string): ParsedFeed {
  return { title, description: undefined, items: [] };
}

function makeAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    relevant: false,
    rawResponse: "{}",
    reason: undefined,
    confidence: undefined,
    tags: undefined,
    ...overrides,
  };
}

describe("analyzeFeeds", () => {
  it("respects parallel limit when processing feeds", async () => {
    const feeds = ["feed-1", "feed-2", "feed-3", "feed-4", "feed-5"];
    let active = 0;
    let maxActive = 0;

    const dependencies = {
      fetchFeed: async (feedUrl: string): Promise<ParsedFeed> => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(5);
        active -= 1;
        return makeFeed(feedUrl);
      },
      analysisClient: { analyze: vi.fn().mockResolvedValue(makeAnalysis()) },
    };

    const results = await analyzeFeeds(feeds, { parallel: 2, dependencies });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results.map((item) => item.feedUrl)).toEqual(feeds);
    expect(results.every((item) => item.status === "fulfilled" && item.feed?.items.length === 0)).toBe(true);
  });

  it("emits progress updates for successes and failures", async () => {
    const feeds = ["feed-ok", "feed-fail", "feed-late"];
    const progress: Array<{ feedUrl: string; completed: number; status: string; error?: string; duration?: number }> = [];

    const dependencies = {
      fetchFeed: async (feedUrl: string): Promise<ParsedFeed> => {
        if (feedUrl === "feed-fail") {
          await delay(2);
          throw new Error("boom");
        }

        await delay(feedUrl === "feed-late" ? 6 : 1);
        return makeFeed(feedUrl);
      },
      analysisClient: { analyze: vi.fn().mockResolvedValue(makeAnalysis()) },
    };

    const results = await analyzeFeeds(feeds, {
      parallel: 2,
      dependencies,
      onProgress(update) {
        progress.push({
          feedUrl: update.feedUrl,
          completed: update.completed,
          status: update.status,
          error: update.error?.message,
          duration: update.durationMs,
        });
      },
      clock: () => Date.now(),
    });

    expect(progress).toHaveLength(feeds.length);
    expect(progress[progress.length - 1].completed).toBe(feeds.length);
    const failedEntry = progress.find((entry) => entry.feedUrl === "feed-fail");
    expect(failedEntry?.status).toBe("rejected");
    expect(failedEntry?.error).toBe("boom");
    expect(progress.every((entry) => typeof entry.duration === "number" || entry.status === "rejected" || entry.duration === undefined)).toBe(true);

    const summary = summarize(results);
    expect(results.filter((item) => item.status === "fulfilled").every((item) => typeof item.durationMs === "number")).toBe(true);
    expect(summary.fulfilled).toHaveLength(2);
    expect(summary.rejected).toHaveLength(1);
    expect(summary.rejected[0].feedUrl).toBe("feed-fail");
  });

  it("rejects invalid parallel values", async () => {
    await expect(analyzeFeeds(["feed"], { parallel: 0 })).rejects.toThrow(RangeError);
  });

  it("honours abort signals", async () => {
    const controller = new AbortController();
    const dependencies = {
      fetchFeed: async () => {
        await delay(5);
        return makeFeed("feed");
      },
      analysisClient: { analyze: vi.fn().mockResolvedValue(makeAnalysis()) },
    };

    const promise = analyzeFeeds(["feed-1", "feed-2"], { parallel: 1, dependencies, signal: controller.signal });
    controller.abort(new Error("stop"));

    await expect(promise).rejects.toThrow(/stop/);
  });

  it("caches fetched feeds to avoid duplicate network work", async () => {
    const feeds = ["https://example.com/feed", "https://example.com/feed"];
    const fetchFeed = vi.fn(async () => ({
      title: "Example",
      description: undefined,
      items: [
        {
          title: "AI in iOS",
          link: "https://example.com/post",
          description: "AI",
          publishedAt: "2025-11-01T00:00:00.000Z",
        },
      ],
    }));
    const analysisClient = {
      analyze: vi.fn().mockResolvedValue(makeAnalysis({ relevant: false })),
    };

    const results = await analyzeFeeds(feeds, {
      dependencies: { fetchFeed, analysisClient },
      months: 3,
      clock: () => Date.parse("2025-12-05T00:00:00.000Z"),
    });

    expect(results).toHaveLength(2);
    expect(fetchFeed).toHaveBeenCalledTimes(1);
    expect(analysisClient.analyze).toHaveBeenCalledTimes(2);
  });

  it("emits verbose logs for month filtering and analyzed posts", async () => {
    const feeds = ["https://example.com/feed"];
    const fetchFeed = vi.fn(async () => ({
      title: "Verbose Feed",
      items: [
        {
          title: "Fresh with description",
          link: "https://example.com/fresh",
          description: "AI in iOS",
          publishedAt: "2025-11-10T00:00:00.000Z",
        },
        {
          title: "Fresh without description",
          link: "https://example.com/no-desc",
          publishedAt: "2025-11-11T00:00:00.000Z",
        },
        {
          title: "Old post",
          link: "https://example.com/old",
          description: "Old",
          publishedAt: "2024-05-01T00:00:00.000Z",
        },
      ],
    }));
    const analysisClient = { analyze: vi.fn().mockResolvedValue(makeAnalysis()) };
    const messages: string[] = [];

    await analyzeFeeds(feeds, {
      dependencies: { fetchFeed, analysisClient },
      months: 2,
      clock: () => Date.parse("2025-12-05T00:00:00.000Z"),
      onVerboseMessage(entry) {
        messages.push(`${entry.feedTitle ?? entry.feedUrl}: ${entry.message}`);
      },
    });

    expect(messages[0]).toMatch(/Found 2 posts within the last 2 months/i);
    expect(messages.some((message) => message.includes('Analyzing post "Fresh with description"'))).toBe(true);
    expect(messages.some((message) => message.includes("Fresh without description"))).toBe(false);
    expect(analysisClient.analyze).toHaveBeenCalledTimes(1);
  });
});

function summarize(results: FeedAnalysisResult[]): { fulfilled: FeedAnalysisResult[]; rejected: FeedAnalysisResult[] } {
  return {
    fulfilled: results.filter((result) => result.status === "fulfilled"),
    rejected: results.filter((result) => result.status === "rejected"),
  };
}

describe("feed item analysis", () => {
  const referenceNow = Date.parse("2025-12-05T00:00:00.000Z");

  it("analyzes only recent posts and returns relevant ones", async () => {
    const analyzeMock = vi
      .fn()
      .mockResolvedValueOnce(makeAnalysis({ relevant: true, reason: "Matches keywords" }))
      .mockResolvedValue(makeAnalysis());

    const dependencies = {
      fetchFeed: async () => ({
        title: "Example",
        items: [
          {
            title: "Fresh post",
            link: "https://example.com/fresh",
            description: "AI in iOS",
            publishedAt: "2025-11-01T00:00:00.000Z",
          },
          {
            title: "Old post",
            link: "https://example.com/old",
            description: "Outdated",
            publishedAt: "2024-01-01T00:00:00.000Z",
          },
        ],
      }),
      analysisClient: { analyze: analyzeMock },
    };

    const [result] = await analyzeFeeds(["https://example.com/feed"], {
      dependencies,
      months: 3,
      clock: () => referenceNow,
    });

    expect(analyzeMock).toHaveBeenCalledTimes(1);
    expect(result.relevantPosts).toHaveLength(1);
    expect(result.relevantPosts?.[0].title).toBe("Fresh post");
  });

  it("filters out AI false positives lacking AI signals", async () => {
    const analyzeMock = vi.fn().mockResolvedValue(makeAnalysis({ relevant: true, reason: "Great charts content" }));
    const dependencies = {
      fetchFeed: async () => ({
        title: "Charts",
        items: [
          {
            title: "Visual debugging with Swift Charts",
            link: "https://example.com/charts",
            description: "Using Swift Charts for debugging game data streams.",
            content: "<p>Using Swift Charts for debugging game data streams.</p>",
            publishedAt: "2025-11-08T00:00:00.000Z",
          },
        ],
      }),
      analysisClient: { analyze: analyzeMock },
    };

    const [result] = await analyzeFeeds(["https://example.com/feed"], {
      dependencies,
      months: 3,
      clock: () => referenceNow,
    });

    expect(analyzeMock).toHaveBeenCalledTimes(1);
    expect(result.relevantPosts ?? []).toHaveLength(0);
  });

  it("analyzes content when description is missing", async () => {
    const analyzeMock = vi.fn().mockResolvedValue(makeAnalysis({ relevant: true, reason: "LLM explained" }));
    const dependencies = {
      fetchFeed: async () => ({
        title: "Content feed",
        items: [
          {
            title: "Deep dive on LLMs",
            link: "https://example.com/llm",
            content: "<div>Everything about LLMs for iOS inference.</div>",
            publishedAt: "2025-11-15T00:00:00.000Z",
          },
        ],
      }),
      analysisClient: { analyze: analyzeMock },
    };

    const [result] = await analyzeFeeds(["https://example.com/feed"], {
      dependencies,
      months: 3,
      clock: () => referenceNow,
    });

    expect(analyzeMock).toHaveBeenCalledTimes(1);
    expect(result.relevantPosts ?? []).toHaveLength(1);
    expect(result.relevantPosts?.[0].title).toBe("Deep dive on LLMs");
  });
});
