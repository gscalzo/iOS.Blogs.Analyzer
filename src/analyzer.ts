import { fetchFeed as defaultFetchFeed } from "./rss-parser.js";
import type { AnalysisResult } from "./ollama-client.js";
import type { FeedItem, FetchFeedOptions, ParsedFeed } from "./types.js";
import { asyncPool } from "./utils.js";

export const DEFAULT_PARALLEL = 3;
export const DEFAULT_MONTH_WINDOW = 3;

export interface FeedAnalysisResult {
  feedUrl: string;
  status: "fulfilled" | "rejected";
  feed?: ParsedFeed;
  error?: Error;
  durationMs?: number;
  analyzedItems?: number;
  relevantPosts?: RelevantPost[];
}

export interface RelevantPost {
  title: string;
  link: string;
  publishedAt?: string;
  analysis: AnalysisResult;
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

export interface AnalysisClient {
  analyze(description: string, options?: { gracefulDegradation?: boolean }): Promise<AnalysisResult>;
}

export interface AnalyzerDependencies {
  fetchFeed: typeof defaultFetchFeed;
  analysisClient: AnalysisClient;
}

const defaultDependencies: AnalyzerDependencies = {
  fetchFeed: defaultFetchFeed,
  analysisClient: {
    async analyze() {
      throw new Error("analysisClient dependency is required");
    },
  },
};

export interface AnalyzeFeedsOptions {
  parallel?: number;
  signal?: AbortSignal;
  fetchOptions?: FetchFeedOptions;
  onProgress?: (update: ProgressUpdate) => void;
  dependencies?: Partial<AnalyzerDependencies>;
  clock?: () => number;
  months?: number;
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

  const months = normalizeMonths(options.months);

  const clock = options.clock ?? (() => Date.now());

  const total = feedUrls.length;
  let completed = 0;

  const results = await asyncPool(
    feedUrls,
    async (feedUrl) => {
      const result: FeedAnalysisResult = { feedUrl, status: "fulfilled" };
      const startedAt = clock();

      try {
        const feed = await dependencies.fetchFeed(feedUrl, {
          ...options.fetchOptions,
        });
        result.feed = feed;
        if (feed.items?.length) {
          const referenceDate = new Date(clock());
          const cutoffDate = subtractMonths(referenceDate, months);
          const analysis = await analyzeFeedItems(feed.items, cutoffDate, dependencies.analysisClient);
          result.analyzedItems = analysis.analyzedCount;
          if (analysis.relevantPosts.length > 0) {
            result.relevantPosts = analysis.relevantPosts;
          }
        }
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

function normalizeMonths(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_MONTH_WINDOW;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError("months must be a positive integer");
  }

  return value;
}

function subtractMonths(date: Date, months: number): Date {
  const safeMonths = Math.max(0, months);
  const result = new Date(date.getTime());
  result.setMonth(result.getMonth() - safeMonths);
  return result;
}

async function analyzeFeedItems(
  items: FeedItem[],
  cutoffDate: Date,
  analysisClient: AnalysisClient,
): Promise<{ analyzedCount: number; relevantPosts: RelevantPost[] }> {
  const relevantPosts: RelevantPost[] = [];
  let analyzedCount = 0;

  for (const item of items) {
    if (!shouldAnalyzeItem(item, cutoffDate)) {
      continue;
    }

    if (!item.description) {
      continue;
    }

    analyzedCount += 1;
    const analysis = await analysisClient.analyze(item.description, { gracefulDegradation: true });

    if (analysis.relevant) {
      relevantPosts.push({
        title: item.title,
        link: item.link,
        publishedAt: item.publishedAt,
        analysis,
      });
    }
  }

  return { analyzedCount, relevantPosts };
}

function shouldAnalyzeItem(item: FeedItem, cutoffDate: Date): boolean {
  const publishedAt = item.publishedAt;

  if (!publishedAt) {
    return false;
  }

  const publishedDate = new Date(publishedAt);
  if (Number.isNaN(publishedDate.getTime())) {
    return false;
  }

  return publishedDate >= cutoffDate;
}