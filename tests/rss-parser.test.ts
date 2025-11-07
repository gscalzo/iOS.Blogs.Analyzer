import { describe, expect, it } from "vitest";
import { fetchFeed, FeedFetchError } from "../src/rss-parser.js";

const SAMPLE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Sample Feed</title>
    <description>Example description</description>
    <link>https://example.com</link>
    <item>
      <title>First Post</title>
      <link>https://example.com/first</link>
      <description>First description</description>
      <pubDate>Fri, 07 Nov 2025 18:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Missing Link</title>
      <description>Should be ignored</description>
    </item>
  </channel>
</rss>`;

describe("fetchFeed", () => {
  it("parses an RSS feed and normalises items", async () => {
    const fetcher: typeof fetch = async () =>
      new Response(SAMPLE_FEED, {
        status: 200,
        headers: { "Content-Type": "application/rss+xml" },
      });

    const feed = await fetchFeed("https://example.com/feed", { fetcher });

    expect(feed.title).toBe("Sample Feed");
    expect(feed.description).toBe("Example description");
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({
      title: "First Post",
      link: "https://example.com/first",
      description: "First description",
      publishedAt: "2025-11-07T18:00:00.000Z",
    });
  });

  it("throws an error for HTTP failures", async () => {
    const fetcher: typeof fetch = async () =>
      new Response("Internal Server Error", {
        status: 500,
        statusText: "Internal Server Error",
      });

    await expect(fetchFeed("https://example.com/missing", { fetcher })).rejects.toMatchObject({
      kind: "http-error",
    });
  });

  it("throws an error for invalid URLs", async () => {
    await expect(fetchFeed("notaurl")).rejects.toMatchObject({
      kind: "invalid-url",
    });
  });

  it("throws a timeout error when fetch does not resolve in time", async () => {
    const abortingFetcher: typeof fetch = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            const error = new Error("Aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      });

    await expect(
      fetchFeed("https://slow.example.com/feed", { timeoutMs: 10, fetcher: abortingFetcher }),
    ).rejects.toMatchObject({
      kind: "timeout",
    });
  });

  it("wraps parsing errors", async () => {
    const fetcher: typeof fetch = async () =>
      new Response("not xml at all", {
        status: 200,
        headers: { "Content-Type": "application/rss+xml" },
      });

    const promise = fetchFeed("https://example.com/bad", { fetcher });

    await expect(promise).rejects.toBeInstanceOf(FeedFetchError);
    await expect(promise).rejects.toMatchObject({
      kind: "parse-error",
    });
  });
});
