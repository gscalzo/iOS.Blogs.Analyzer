import { fetchFeed as defaultFetchFeed } from "./rss-parser.js";
import type { FetchFeedOptions, ParsedFeed } from "./types.js";
import { asyncPool } from "./utils.js";

export const DEFAULT_PARALLEL = 3;

export interface FeedAnalysisResult {
  feedUrl: string;
  status: "fulfilled" | "rejected";
  feed?: ParsedFeed;
  error?: Error;
  durationMs?: number;
}

export interface ProgressUpdate {
  feedUrl: string;
  completed: number;
  total: number;
  status: FeedAnalysisResult["status"];
  feed?: ParsedFeed;
  error?: Error;
  durationMs?: number;
}

export interface AnalyzerDependencies {
  fetchFeed: typeof defaultFetchFeed;
}

const defaultDependencies: AnalyzerDependencies = {
  fetchFeed: defaultFetchFeed,
};

export interface AnalyzeFeedsOptions {
  parallel?: number;
  signal?: AbortSignal;
  fetchOptions?: FetchFeedOptions;
  onProgress?: (update: ProgressUpdate) => void;
  dependencies?: Partial<AnalyzerDependencies>;
  clock?: () => number;
}

export async function analyzeFeeds(feedUrls: readonly string[], options: AnalyzeFeedsOptions = {}): Promise<FeedAnalysisResult[]> {
  if (!Array.isArray(feedUrls)) {
    throw new TypeError("feedUrls must be an array");
  }

  const parallel = options.parallel ?? DEFAULT_PARALLEL;

  if (!Number.isInteger(parallel) || parallel <= 0) {
    throw new RangeError("parallel must be a positive integer");
  }

  const dependencies: AnalyzerDependencies = {
    ...defaultDependencies,
    ...options.dependencies,
  };

  const clock = options.clock ?? (() => Date.now());

  const total = feedUrls.length;
  let completed = 0;

  const results = await asyncPool(
    feedUrls,
    async (feedUrl) => {
      const result: FeedAnalysisResult = { feedUrl, status: "fulfilled" };
      const startedAt = clock();

      try {
        result.feed = await dependencies.fetchFeed(feedUrl, {
          ...options.fetchOptions,
        });
      } catch (error) {
        result.status = "rejected";
        result.error = error instanceof Error ? error : new Error(String(error));
      } finally {
        const finishedAt = clock();
        if (Number.isFinite(finishedAt) && Number.isFinite(startedAt)) {
          const duration = finishedAt - startedAt;
          result.durationMs = Number.isFinite(duration) ? Math.max(0, duration) : undefined;
        }
      }

      completed += 1;
      options.onProgress?.({
        feedUrl,
        completed,
        total,
        status: result.status,
        feed: result.feed,
        error: result.error,
        durationMs: result.durationMs,
      });

      return result;
    },
    { concurrency: parallel, signal: options.signal },
  );

  return results;
}