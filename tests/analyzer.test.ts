import { describe, expect, it } from "vitest";
import { analyzeFeeds, type FeedAnalysisResult } from "../src/analyzer.js";
import type { ParsedFeed } from "../src/types.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeFeed(title: string): ParsedFeed {
  return { title, description: undefined, items: [] };
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
    };

    const results = await analyzeFeeds(feeds, { parallel: 2, dependencies });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results.map((item) => item.feedUrl)).toEqual(feeds);
    expect(results.every((item) => item.status === "fulfilled" && item.feed?.items.length === 0)).toBe(true);
  });

  it("emits progress updates for successes and failures", async () => {
    const feeds = ["feed-ok", "feed-fail", "feed-late"];
    const progress: Array<{ feedUrl: string; completed: number; status: string; error?: string }> = [];

    const dependencies = {
      fetchFeed: async (feedUrl: string): Promise<ParsedFeed> => {
        if (feedUrl === "feed-fail") {
          await delay(2);
          throw new Error("boom");
        }

        await delay(feedUrl === "feed-late" ? 6 : 1);
        return makeFeed(feedUrl);
      },
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
        });
      },
    });

    expect(progress).toHaveLength(feeds.length);
    expect(progress[progress.length - 1].completed).toBe(feeds.length);
    const failedEntry = progress.find((entry) => entry.feedUrl === "feed-fail");
    expect(failedEntry?.status).toBe("rejected");
    expect(failedEntry?.error).toBe("boom");

    const summary = summarize(results);
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
    };

    const promise = analyzeFeeds(["feed-1", "feed-2"], { parallel: 1, dependencies, signal: controller.signal });
    controller.abort(new Error("stop"));

    await expect(promise).rejects.toThrow(/stop/);
  });
});

function summarize(results: FeedAnalysisResult[]): { fulfilled: FeedAnalysisResult[]; rejected: FeedAnalysisResult[] } {
  return {
    fulfilled: results.filter((result) => result.status === "fulfilled"),
    rejected: results.filter((result) => result.status === "rejected"),
  };
}
