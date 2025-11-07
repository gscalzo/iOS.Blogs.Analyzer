import Parser from "rss-parser";
import type { FetchFeedOptions, FeedItem, ParsedFeed } from "./types.js";

export type FeedFetchErrorKind =
  | "invalid-url"
  | "timeout"
  | "http-error"
  | "fetch-error"
  | "parse-error";

export class FeedFetchError extends Error {
  constructor(message: string, public readonly kind: FeedFetchErrorKind, options?: ErrorOptions) {
    super(message, options);
    this.name = "FeedFetchError";
  }
}

const DEFAULT_TIMEOUT_MS = 1000 * 10;
const DEFAULT_USER_AGENT = "iOS Blogs Analyzer/0.1 (+https://github.com/)";

type ParserItem = Parser.Item & {
  summary?: string;
  [key: string]: unknown;
};

export async function fetchFeed(url: string, options: FetchFeedOptions = {}): Promise<ParsedFeed> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, userAgent = DEFAULT_USER_AGENT, fetcher = fetch } = options;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch (error) {
    throw new FeedFetchError(`Invalid feed URL: ${url}`, "invalid-url", { cause: error });
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new FeedFetchError(`Unsupported protocol for feed URL: ${url}`, "invalid-url");
  }

  const controller = new AbortSignalController(timeoutMs);

  let response: Response;
  try {
    response = await fetcher(url, {
      signal: controller.signal,
      headers: { "user-agent": userAgent },
    } satisfies RequestInit);
  } catch (error) {
    controller.dispose();
    if ((error as Error)?.name === "AbortError") {
      throw new FeedFetchError(`Fetching feed timed out after ${timeoutMs}ms: ${url}`, "timeout", { cause: error });
    }
    throw new FeedFetchError(`Failed to fetch feed: ${url}`, "fetch-error", { cause: error });
  }

  controller.dispose();

  if (!response.ok) {
    throw new FeedFetchError(
      `Feed responded with HTTP ${response.status} for ${url}`,
      "http-error",
      { cause: new Error(response.statusText || "HTTP error") },
    );
  }

  const xml = await response.text();

  let parsed: Parser.Output<ParserItem>;
  try {
    const parserInstance = new Parser<Parser.Output<ParserItem>, ParserItem>({
      timeout: timeoutMs,
    });
    parsed = await parserInstance.parseString(xml);
    const items: FeedItem[] = (parsed.items ?? [])
      .map((item) => mapItemToFeed(item))
      .filter((item): item is FeedItem => item !== null);

    return {
      title: parsed.title ?? undefined,
      description: parsed.description ?? undefined,
      items,
    } satisfies ParsedFeed;
  } catch (error) {
    throw new FeedFetchError(`Failed to parse feed contents from ${url}`, "parse-error", { cause: error });
  }
}

// Small helper to pair an AbortController with a timeout and ensure cleanup.
class AbortSignalController {
  private readonly controller = new AbortController();
  private readonly timer: NodeJS.Timeout;

  constructor(timeoutMs: number) {
    this.timer = setTimeout(() => this.controller.abort(), timeoutMs);
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  dispose(): void {
    clearTimeout(this.timer);
  }
}

function mapItemToFeed(item: ParserItem): FeedItem | null {
  const title = item.title?.trim();
  const link = item.link?.trim();

  if (!title || !link) {
    return null;
  }

  const descriptionCandidate = selectFirstString(
    item.contentSnippet,
    item.content,
    typeof item["content:encoded"] === "string" ? (item["content:encoded"] as string) : undefined,
    item.summary,
  );

  const publishedAt = selectFirstString(item.isoDate, item.pubDate);

  return {
    title,
    link,
    description: descriptionCandidate ?? undefined,
    publishedAt: publishedAt ?? undefined,
  } satisfies FeedItem;
}

function selectFirstString(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return null;
}