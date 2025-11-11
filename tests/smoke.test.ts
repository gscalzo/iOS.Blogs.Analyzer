import { beforeEach, describe, expect, it, vi } from "vitest";
import { main, parseArguments } from "../src/index.js";
import type { BlogsDirectory } from "../src/types.js";
import { extractFeedUrls, loadBlogs } from "../src/blogs.js";

vi.mock("../src/blogs.js");

const mockedLoadBlogs = vi.mocked(loadBlogs);
const mockedExtractFeedUrls = vi.mocked(extractFeedUrls);

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

  it("loads blogs and writes feed count", async () => {
    mockedLoadBlogs.mockResolvedValue(sampleBlogs);
    mockedExtractFeedUrls.mockReturnValue(["https://example.com/feed"]);

    const stdout = createWriter();
    const stderr = createWriter();

    await main({ argv: [], stdout: stdout.writer, stderr: stderr.writer });

    expect(mockedLoadBlogs).toHaveBeenCalledTimes(1);
    expect(mockedExtractFeedUrls).toHaveBeenCalledWith(sampleBlogs, { maxBlogs: undefined });
    expect(stdout.messages.join("")).toContain("Loaded 1 feed URLs.");
    expect(stderr.messages).toHaveLength(0);
    expect(process.exitCode).toBe(0);
  });

  it("respects --max-blogs argument", async () => {
    mockedLoadBlogs.mockResolvedValue(sampleBlogs);
    mockedExtractFeedUrls.mockReturnValue(["https://example.com/feed"]);

    const stdout = createWriter();
    const stderr = createWriter();

    await main({ argv: ["--max-blogs", "1"], stdout: stdout.writer, stderr: stderr.writer });

    expect(mockedExtractFeedUrls).toHaveBeenCalledWith(sampleBlogs, { maxBlogs: 1 });
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

  it("shows help when requested", async () => {
    const stdout = createWriter();

    await main({ argv: ["--help"], stdout: stdout.writer });

    expect(stdout.messages.join("")).toMatch(/Usage/);
    expect(mockedLoadBlogs).not.toHaveBeenCalled();
  });
});