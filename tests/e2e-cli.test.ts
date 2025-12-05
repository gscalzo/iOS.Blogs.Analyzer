import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import * as fs from "node:fs/promises";
import { main } from "../src/index.js";

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

    await main({ argv: ["--max-blogs", "1", "--verbose"], stdout: stdout.writer, stderr: stderr.writer, now, env: {} });

    const stdoutText = stdout.messages.join("");
    expect(stdoutText).toContain("Loaded 1 feed URLs.");
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
      argv: ["--max-blogs", "1", "--output", `csv:${outputPath}`],
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
});
