import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { loadBlogs, extractFeedUrls } from "../src/blogs.js";
import { analyzeFeeds, type AnalysisClient } from "../src/analyzer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("end-to-end pipeline", () => {
  it("processes feeds with mocked fetch and Ollama responses", async () => {
    const blogsPath = path.resolve(__dirname, "fixtures/blogs-mini.json");
    const schemaPath = path.resolve(process.cwd(), "schema_blogs.json");
    const blogs = await loadBlogs({ filePath: blogsPath, schemaPath });
    const feeds = extractFeedUrls(blogs);
    expect(feeds).toEqual(["https://integration.example/feed"]);

    const xml = await readFile(path.resolve(__dirname, "fixtures/rss-integration.xml"), "utf8");
    const fetcher = vi.fn(async () => new Response(xml, { status: 200, headers: { "content-type": "application/xml" } }));

    const analyzeMock: AnalysisClient["analyze"] = vi.fn(async (text: string) => {
      if (text.includes("AI")) {
        return {
          relevant: true,
          rawResponse: "{}",
          reason: "Contains AI workflows",
          confidence: 0.93,
          tags: ["ai", "ios"],
        };
      }

      return {
        relevant: false,
        rawResponse: "{}",
        reason: undefined,
        confidence: undefined,
        tags: undefined,
      };
    });

    const analysisClient: AnalysisClient = {
      analyze: analyzeMock,
    };

    const referenceNow = Date.parse("2025-12-05T00:00:00.000Z");

    const results = await analyzeFeeds(feeds, {
      dependencies: { analysisClient },
      fetchOptions: { fetcher },
      months: 3,
      clock: () => referenceNow,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(analyzeMock).toHaveBeenCalledTimes(1);
    const [result] = results;
    expect(result.status).toBe("fulfilled");
    expect(result.relevantPosts).toHaveLength(1);
    const relevantPost = result.relevantPosts?.[0];
    expect(relevantPost?.title).toBe("Building AI assistants for iOS");
    expect(relevantPost?.analysis.reason).toBe("Contains AI workflows");
    expect(result.analyzedItems).toBe(1);
  });
});
