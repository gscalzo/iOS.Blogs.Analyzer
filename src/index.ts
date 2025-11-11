import { extractFeedUrls, loadBlogs } from "./blogs.js";
import { analyzeFeeds, DEFAULT_PARALLEL, type FeedAnalysisResult } from "./analyzer.js";

export interface CliArguments {
  maxBlogs?: number;
  helpRequested?: boolean;
  parallel?: number;
}

export interface MainOptions {
  argv?: string[];
  stdout?: { write(message: string): unknown };
  stderr?: { write(message: string): unknown };
  now?: () => number;
}

class CliError extends Error {
  constructor(message: string, public readonly exitCode: number = 1) {
    super(message);
    this.name = "CliError";
  }
}

export function parseArguments(argv: string[]): CliArguments {
  const result: CliArguments = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--help" || token === "-h") {
      result.helpRequested = true;
      continue;
    }

    if (token === "--max-blogs" || token.startsWith("--max-blogs=")) {
      const value = token === "--max-blogs" ? argv[++index] : token.slice("--max-blogs=".length);

      if (!value) {
        throw new CliError("Missing value for --max-blogs");
      }

      const parsed = Number.parseInt(value, 10);

      if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
        throw new CliError("--max-blogs must be a non-negative integer");
      }

      result.maxBlogs = parsed;
      continue;
    }

    if (token === "--parallel" || token.startsWith("--parallel=")) {
      const value = token === "--parallel" ? argv[++index] : token.slice("--parallel=".length);

      if (!value) {
        throw new CliError("Missing value for --parallel");
      }

      const parsed = Number.parseInt(value, 10);

      if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
        throw new CliError("--parallel must be a positive integer");
      }

      result.parallel = parsed;
      continue;
    }

    throw new CliError(`Unknown argument: ${token}`);
  }

  return result;
}

function renderHelp(): string {
  return [
    "iOS Blogs Analyzer",
    "",
    "Usage:",
    "  ios-blogs-analyzer [options]",
    "",
    "Options:",
    "  --max-blogs <number>   Limit the number of feeds processed",
    "  --parallel <number>    Maximum concurrent requests (default: 3)",
    "  -h, --help              Show this help message",
    "",
  ].join("\n");
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function estimateRemainingMs(completed: number, total: number, elapsedMs: number): number | undefined {
  if (completed === 0 || elapsedMs <= 0) {
    return undefined;
  }

  const remaining = total - completed;
  if (remaining <= 0) {
    return 0;
  }

  const ratePerMs = completed / elapsedMs;
  if (ratePerMs <= 0) {
    return undefined;
  }

  return Math.round(remaining / ratePerMs);
}

function summarize(results: FeedAnalysisResult[]): { succeeded: FeedAnalysisResult[]; failed: FeedAnalysisResult[] } {
  const succeeded: FeedAnalysisResult[] = [];
  const failed: FeedAnalysisResult[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      succeeded.push(result);
      continue;
    }

    failed.push(result);
  }

  return { succeeded, failed };
}

export async function main(options: MainOptions = {}): Promise<void> {
  const {
    argv = process.argv.slice(2),
    stdout = process.stdout,
    stderr = process.stderr,
    now = () => Date.now(),
  } = options;

  let cliArguments: CliArguments;

  try {
    cliArguments = parseArguments(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to parse arguments";
    stderr.write(`Error: ${message}\n`);
    process.exitCode = error instanceof CliError ? error.exitCode : 1;
    return;
  }

  if (cliArguments.helpRequested) {
    stdout.write(`${renderHelp()}`);
    return;
  }

  try {
    const blogs = await loadBlogs();
    const feeds = extractFeedUrls(blogs, { maxBlogs: cliArguments.maxBlogs });
    stdout.write(`Loaded ${feeds.length} feed URLs.\n`);

    if (feeds.length === 0) {
      stdout.write("No feeds to process.\n");
      return;
    }

    const total = feeds.length;
    const startedAt = now();
    stdout.write(`Processing with up to ${cliArguments.parallel ?? DEFAULT_PARALLEL} concurrent requests...\n`);

    const results = await analyzeFeeds(feeds, {
      parallel: cliArguments.parallel ?? DEFAULT_PARALLEL,
      onProgress(update) {
        const elapsedMs = now() - startedAt;
        const etaMs = estimateRemainingMs(update.completed, update.total, elapsedMs);
        const etaText = etaMs === undefined ? "--" : formatDuration(etaMs);
        const statusLabel = update.status === "fulfilled" ? "ok" : "error";
        const parts = [
          `[${update.completed}/${update.total}]`,
          statusLabel.toUpperCase(),
          update.feedUrl,
          `(eta ${etaText})`,
        ];

        if (update.status === "rejected" && update.error) {
          parts.push(`- ${update.error.message}`);
        }

        stdout.write(`${parts.join(" ")}\n`);
      },
    });

    const elapsedMs = now() - startedAt;
    const { succeeded, failed } = summarize(results);
    stdout.write(
      `Finished ${total} feeds: ${succeeded.length} succeeded, ${failed.length} failed in ${formatDuration(elapsedMs)}.\n`,
    );

    if (failed.length > 0) {
      stderr.write("Failed feeds:\n");
      for (const item of failed) {
        const reason = item.error?.message ?? "Unknown error";
        stderr.write(`  - ${item.feedUrl}: ${reason}\n`);
      }
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    stderr.write(`Error: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unexpected failure";
    console.error(`Unexpected error: ${message}`);
    process.exitCode = 1;
  });
}