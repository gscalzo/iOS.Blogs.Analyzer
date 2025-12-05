import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractFeedUrls, loadBlogs, BlogDataError } from "../src/blogs.js";

const fixturesDir = path.dirname(fileURLToPath(new URL("./fixtures/blogs-sample.json", import.meta.url)));
const sampleFilePath = path.join(fixturesDir, "blogs-sample.json");
const invalidStructurePath = path.join(fixturesDir, "blogs-invalid-structure.json");
const notJsonPath = path.join(fixturesDir, "not-json.txt");

describe("loadBlogs", () => {
  it("loads and validates the blogs directory", async () => {
    const blogs = await loadBlogs({ filePath: sampleFilePath });

    expect(blogs).toHaveLength(2);
    expect(blogs[0].categories[0].sites[0].feed_url).toBe("https://sample.example.com/feed");
  });

  it("defaults missing URL schemes to https", async () => {
    const blogs = await loadBlogs({ filePath: sampleFilePath });

    const site = blogs[0].categories[0].sites[2];
    expect(site.site_url).toBe("https://third.example.com");
    expect(site.feed_url).toBe("https://third.example.com/rss");
    expect(site.twitter_url).toBe("https://twitter.com/third");
  });

  it("throws a parse error when JSON is invalid", async () => {
    await expect(loadBlogs({ filePath: notJsonPath })).rejects.toMatchObject({
      kind: "parse-error",
    });
  });

  it("throws a validation error when structure is incorrect", async () => {
    await expect(loadBlogs({ filePath: invalidStructurePath })).rejects.toBeInstanceOf(BlogDataError);
    await expect(loadBlogs({ filePath: invalidStructurePath })).rejects.toMatchObject({
      kind: "validation-error",
    });
  });
});

describe("extractFeedUrls", () => {
  it("returns all feed URLs in traversal order", async () => {
    const blogs = await loadBlogs({ filePath: sampleFilePath });

    expect(extractFeedUrls(blogs)).toEqual([
      "https://sample.example.com/feed",
      "https://secondary.example.com/rss",
      "https://third.example.com/rss",
      "https://es.example.com/feed",
    ]);
  });

  it("respects the maxBlogs limit", async () => {
    const blogs = await loadBlogs({ filePath: sampleFilePath });

    expect(extractFeedUrls(blogs, { maxBlogs: 2 })).toEqual([
      "https://sample.example.com/feed",
      "https://secondary.example.com/rss",
    ]);
  });

  it("filters feeds by language when provided", async () => {
    const blogs = await loadBlogs({ filePath: sampleFilePath });

    expect(extractFeedUrls(blogs, { language: "es" })).toEqual(["https://es.example.com/feed"]);
    expect(extractFeedUrls(blogs, { languages: ["EN"] })).toEqual([
      "https://sample.example.com/feed",
      "https://secondary.example.com/rss",
      "https://third.example.com/rss",
    ]);
  });

  it("filters feeds by category allowlist", async () => {
    const blogs = await loadBlogs({ filePath: sampleFilePath });

    expect(extractFeedUrls(blogs, { categories: ["Platform"] })).toEqual([
      "https://sample.example.com/feed",
      "https://secondary.example.com/rss",
      "https://third.example.com/rss",
    ]);

    expect(extractFeedUrls(blogs, { categories: ["Noticias"] })).toEqual(["https://es.example.com/feed"]);
  });

  it("throws when maxBlogs is negative", async () => {
    const blogs = await loadBlogs({ filePath: sampleFilePath });

    expect(() => extractFeedUrls(blogs, { maxBlogs: -1 })).toThrow(RangeError);
  });
});
