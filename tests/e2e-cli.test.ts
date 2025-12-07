import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import * as fs from "node:fs/promises";
import { main } from "../src/index.js";
import { loadFilterConfig } from "../src/config.js";

const fixturesDir = path.resolve(process.cwd(), "tests/fixtures");
const blogsFixturePath = path.join(fixturesDir, "blogs-mini.json");
const rssFixturePath = path.join(fixturesDir, "rss-integration.xml");
const schemaPath = path.resolve(process.cwd(), "schema_blogs.json");

const { ollamaMocks } = vi.hoisted(() => {
  const analyze = vi.fn(async (text: string) => {
    if (text.toLowerCase().includes("ai")) {
      return {
        relevant: true,
        rawResponse: "{}",
        reason: "AI content detected",
        confidence: 0.91,
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

  const checkConnection = vi.fn().mockResolvedValue(undefined);

  return {
    ollamaMocks: {
      analyze,
      checkConnection,
      factory: vi.fn(() => ({ checkConnection, analyze })),
    },
  };
});

vi.mock("../src/ollama-client.js", () => ({
  OllamaClient: ollamaMocks.factory,
}));

vi.mock("../src/blogs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/blogs.js")>();
  return {
    ...actual,
    async loadBlogs() {
      return actual.loadBlogs({ filePath: blogsFixturePath, schemaPath });
    },
  };
});

vi.mock("../src/config.js", () => ({
  loadFilterConfig: vi.fn(),
}));

const mockedLoadFilterConfig = vi.mocked(loadFilterConfig);

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

describe("CLI end-to-end", () => {
  beforeEach(async () => {
    mockedLoadFilterConfig.mockResolvedValue({ allowedLanguages: ["en"], allowedCategories: ["indie"] });
    const rss = await fs.readFile(rssFixturePath, "utf8");
    const fetchMock = vi.fn(async () => new Response(rss, { status: 200, headers: { "content-type": "application/xml" } }));
    vi.stubGlobal("fetch", fetchMock);
    ollamaMocks.analyze.mockClear();
    ollamaMocks.checkConnection.mockClear();
    ollamaMocks.factory.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("runs the full pipeline and prints JSON output", async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    let currentTime = 0;
    const now = () => {
      currentTime += 500;
      return currentTime;
    };

    await main({ argv: ["--max-blogs", "1", "--verbose", "--model", "llama3.1"], stdout: stdout.writer, stderr: stderr.writer, now, env: {} });

    const stdoutText = stdout.messages.join("");
    expect(stdoutText).toContain("Loaded 1 feed URLs (languages: en; categories: 1 categories).");
    expect(stdoutText).toContain("Processing with up to 3 concurrent requests");
    expect(stdoutText).toMatch(/Finished 1 feeds: 1 succeeded, 0 failed/);
    expect(stdoutText).toContain('"feeds"');
    expect(stdoutText).toContain("Integration Feed");
    expect(stdoutText).toContain("AI content detected");
    expect(stderr.messages).toHaveLength(0);
    expect(ollamaMocks.analyze).toHaveBeenCalled();
  });

  it("writes CSV output when requested", async () => {
    const stdout = createWriter();
    const stderr = createWriter();
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ios-blogs-e2e-"));
    const outputPath = path.join(tempDir, "report.csv");

    await main({
      argv: ["--max-blogs", "1", "--output", `csv:${outputPath}`, "--model", "llama3.1"],
      stdout: stdout.writer,
      stderr: stderr.writer,
      env: {},
    });

    const csvContents = await fs.readFile(outputPath, "utf8");
    expect(csvContents).toContain("feed_title,feed_url,post_title,post_link,published_at,confidence,tags,reason");
    expect(csvContents).toContain("Integration Feed");
    expect(csvContents).toContain("AI content detected");
    expect(stdout.messages.join("")).toContain(`Results written to ${outputPath}`);
    expect(stderr.messages).toHaveLength(0);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("writes performance log output when requested", async () => {
    const stdout = createWriter();
    const stderr = createWriter();
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ios-blogs-perf-"));
    const perfLogPath = path.join(tempDir, "perf.json");

    await main({
      argv: ["--max-blogs", "1", "--perf-log", perfLogPath, "--model", "llama3.1"],
      stdout: stdout.writer,
      stderr: stderr.writer,
      env: {},
    });

    const perfContents = await fs.readFile(perfLogPath, "utf8");
    const payload = JSON.parse(perfContents);
    expect(payload.summary.totalFeeds).toBe(1);
    expect(payload.summary.failed).toBe(0);
    expect(payload.parameters.parallel).toBe(3);
    expect(payload.feeds).toHaveLength(1);
    expect(payload.feeds[0].feedUrl).toBe("https://integration.example/feed");
    expect(payload.feeds[0].status).toBe("fulfilled");
    expect(stdout.messages.join("")).toContain(`Performance log saved to ${perfLogPath}`);
    expect(stderr.messages).toHaveLength(0);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("writes markdown output with checkboxes when requested", async () => {
    const stdout = createWriter();
    const stderr = createWriter();
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ios-blogs-md-"));
    const outputPath = path.join(tempDir, "ai-list.md");

    await main({
      argv: ["--max-blogs", "1", "--output", `md:${outputPath}`, "--model", "llama3.1"],
      stdout: stdout.writer,
      stderr: stderr.writer,
      env: {},
    });

    const mdContents = await fs.readFile(outputPath, "utf8");
    expect(mdContents).toContain("# iOS Blogs AI List");
    expect(mdContents).toMatch(/- \[ \] \[.*\]\(http.*\)/);
    expect(stdout.messages.join("")).toContain(`Results written to ${outputPath}`);
    expect(stderr.messages).toHaveLength(0);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("passes the CLI model to the Ollama client", async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    await main({ argv: ["--max-blogs", "1", "--model", "qwq"], stdout: stdout.writer, stderr: stderr.writer, env: {} });

    expect(ollamaMocks.factory).toHaveBeenCalledTimes(1);
    expect(ollamaMocks.factory.mock.calls[0][0]).toMatchObject({ model: "qwq" });
    expect(ollamaMocks.analyze).toHaveBeenCalled();
    expect(stderr.messages).toHaveLength(0);
  });
});
