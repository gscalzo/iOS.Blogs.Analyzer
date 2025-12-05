import { writeFile } from "node:fs/promises";
import yargs, { type ArgumentsCamelCase } from "yargs";
import { extractFeedUrls, loadBlogs } from "./blogs.js";
import { analyzeFeeds, DEFAULT_MONTH_WINDOW, DEFAULT_PARALLEL, type FeedAnalysisResult, type RelevantPost } from "./analyzer.js";
import { OllamaClient } from "./ollama-client.js";

export type OutputFormat = "json" | "csv";

export interface OutputTarget {
  format: OutputFormat;
  destination?: string;
}

export interface CliArguments {
  maxBlogs?: number;
  helpRequested?: boolean;
  parallel?: number;
  model?: string;
  output?: OutputTarget;
  verbose?: boolean;
  months?: number;
}

export interface MainOptions {
  argv?: string[];
  stdout?: { write(message: string): unknown };
  stderr?: { write(message: string): unknown };
  now?: () => number;
  env?: NodeJS.ProcessEnv;
}

const MODEL_ENV_VARIABLE = "IOS_BLOGS_ANALYZER_MODEL";
const OUTPUT_FORMATS: OutputFormat[] = ["json", "csv"];

class CliError extends Error {
  public readonly exitCode: number;

  constructor(message: string, exitCode: number = 1) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

export function parseArguments(argv: string[]): CliArguments {
  const filteredArgv: string[] = [];
  let helpRequested = false;

  for (const token of argv) {
    if (token === "--help" || token === "-h") {
      helpRequested = true;
      continue;
    }
    filteredArgv.push(token);
  }

  type ParsedShape = {
    help?: boolean;
    maxBlogs?: number;
    parallel?: number;
    model?: string;
    output?: string;
    verbose?: boolean;
    months?: number;
  };

  const parser = yargs(filteredArgv)
    .parserConfiguration({
      "camel-case-expansion": true,
      "dot-notation": false,
      "duplicate-arguments-array": false,
      "flatten-duplicate-arrays": true,
    })
    .option("max-blogs", {
      type: "number",
      describe: "Limit the number of feeds processed",
    })
    .option("parallel", {
      type: "number",
      describe: "Maximum concurrent requests",
    })
    .option("months", {
      type: "number",
      describe: `Analyze posts published within the last N months (default: ${DEFAULT_MONTH_WINDOW})`,
    })
    .option("model", {
      type: "string",
      describe: "Ollama model to use",
    })
    .option("output", {
      type: "string",
      describe: "Write results to the specified file",
    })
    .option("verbose", {
      type: "boolean",
      describe: "Enable verbose logging",
    })
    .alias("verbose", "v")
    .exitProcess(false)
    .help(false)
    .showHelpOnFail(false)
    .version(false)
    .strict();

  let parsed: ArgumentsCamelCase<ParsedShape>;

  try {
    parsed = parser.parseSync();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid CLI arguments";
    throw new CliError(message);
  }

  const result: CliArguments = {};

  if (helpRequested || parsed.help) {
    result.helpRequested = true;
  }

  if (parsed.maxBlogs !== undefined) {
    const value = parsed.maxBlogs;
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      throw new CliError("--max-blogs must be a non-negative integer");
    }
    result.maxBlogs = value;
  }

  if (parsed.parallel !== undefined) {
    const value = parsed.parallel;
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
      throw new CliError("--parallel must be a positive integer");
    }
    result.parallel = value;
  }

  if (parsed.months !== undefined) {
    const value = parsed.months;
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
      throw new CliError("--months must be a positive integer");
    }
    result.months = value;
  }

  if (typeof parsed.model === "string") {
    const trimmed = parsed.model.trim();
    if (trimmed.length === 0) {
      throw new CliError("--model must be a non-empty string");
    }
    result.model = trimmed;
  }

  if (typeof parsed.output === "string") {
    const trimmed = parsed.output.trim();
    if (trimmed.length === 0) {
      throw new CliError("--output must be a non-empty string");
    }
    result.output = parseOutputOption(trimmed);
  }

  if (typeof parsed.verbose === "boolean") {
    result.verbose = parsed.verbose;
  }

  return result;
}

function parseOutputOption(spec: string): OutputTarget {
  const trimmed = spec.trim();
  if (trimmed.length === 0) {
    throw new CliError("--output must be a non-empty string");
  }

  const lowerCased = trimmed.toLowerCase();
  if (isSupportedOutputFormat(lowerCased)) {
    return { format: lowerCased, destination: undefined };
  }

  const colonIndex = trimmed.indexOf(":");
  if (colonIndex > -1) {
    const prefix = trimmed.slice(0, colonIndex).toLowerCase();
    const remainder = trimmed.slice(colonIndex + 1).trim();
    if (isSupportedOutputFormat(prefix)) {
      return {
        format: prefix,
        destination: remainder.length > 0 ? remainder : undefined,
      };
    }

    if (shouldFlagUnknownFormat(prefix, remainder)) {
      throw new CliError(`--output format must be one of: ${OUTPUT_FORMATS.join(", ")}`);
    }
  }

  return { format: "json", destination: trimmed };
}

function isSupportedOutputFormat(value: string): value is OutputFormat {
  return OUTPUT_FORMATS.includes(value as OutputFormat);
}

function shouldFlagUnknownFormat(prefix: string, remainder: string): boolean {
  if (prefix.length < 2) {
    return false;
  }
  if (remainder.startsWith("//") || remainder.startsWith("\\") || remainder.startsWith("/")) {
    return false;
  }
  return /^[a-z]+$/i.test(prefix);
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
    "  --model <name>         Ollama model to use (default: llama3.1)",
    `  --months <number>      Analyze posts within the last N months (default: ${DEFAULT_MONTH_WINDOW})`,
    "  --output [format:]<target>  Choose output format (json|csv) and optional file",
    "                              e.g., --output csv:report.csv",
    "  --verbose, -v           Enable verbose logging",
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

function summarize(results: FeedAnalysisResult[]): {
  succeeded: FeedAnalysisResult[];
  failed: FeedAnalysisResult[];
  averageDurationMs?: number;
} {
  const succeeded: FeedAnalysisResult[] = [];
  const failed: FeedAnalysisResult[] = [];
  const durations: number[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      succeeded.push(result);
      if (typeof result.durationMs === "number" && Number.isFinite(result.durationMs)) {
        durations.push(result.durationMs);
      }
      continue;
    }

    failed.push(result);
  }

  const averageDurationMs = durations.length > 0 ? durations.reduce((sum, value) => sum + value, 0) / durations.length : undefined;

  return { succeeded, failed, averageDurationMs };
}

interface FeedReport {
  feedUrl: string;
  feedTitle?: string;
  relevantPosts: PostReport[];
}

interface PostReport {
  title: string;
  link: string;
  publishedAt?: string;
  confidence?: number;
  reason?: string;
  tags?: string[];
}

function buildFeedReports(results: FeedAnalysisResult[]): FeedReport[] {
  return results
    .filter((result) => Array.isArray(result.relevantPosts) && result.relevantPosts.length > 0)
    .map((result) => ({
      feedUrl: result.feedUrl,
      feedTitle: result.feed?.title ?? undefined,
      relevantPosts: (result.relevantPosts ?? []).map((post) => ({
        title: post.title,
        link: post.link,
        publishedAt: post.publishedAt,
        confidence: post.analysis.confidence,
        reason: post.analysis.reason,
        tags: post.analysis.tags,
      })),
    }));
}

async function emitJsonReport(
  reports: FeedReport[],
  destination: string | undefined,
  stdout: NonNullable<MainOptions["stdout"]>,
): Promise<void> {
  const payload = JSON.stringify({ feeds: reports }, null, 2);

  if (destination) {
    await writeFile(destination, `${payload}\n`, "utf8");
    stdout.write(`Results written to ${destination}\n`);
    return;
  }

  stdout.write(`${payload}\n`);
}

async function emitCsvReport(
  reports: FeedReport[],
  destination: string | undefined,
  stdout: NonNullable<MainOptions["stdout"]>,
): Promise<void> {
  const payload = createCsvPayload(reports);
  const output = `${payload}\n`;

  if (destination) {
    await writeFile(destination, output, "utf8");
    stdout.write(`Results written to ${destination}\n`);
    return;
  }

  stdout.write(output);
}

function createCsvPayload(reports: FeedReport[]): string {
  const header = ["feed_title", "feed_url", "post_title", "post_link", "published_at", "confidence", "tags", "reason"];
  const rows: string[][] = [header];

  for (const report of reports) {
    for (const post of report.relevantPosts) {
      rows.push([
        report.feedTitle ?? report.feedUrl,
        report.feedUrl,
        post.title,
        post.link,
        post.publishedAt ?? "",
        formatOptionalNumber(post.confidence),
        (post.tags ?? []).join(";"),
        post.reason ?? "",
      ]);
    }
  }

  return rows.map((row) => row.map(escapeCsvValue).join(",")).join("\n");
}

function escapeCsvValue(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n");
  if (normalized.length === 0) {
    return "";
  }

  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }

  return normalized;
}

function formatOptionalNumber(value: number | undefined): string {
  if (!Number.isFinite(value)) {
    return "";
  }
  return String(value);
}

function logVerboseFindings(reports: FeedReport[], stdout: NonNullable<MainOptions["stdout"]>): void {
  if (reports.length === 0) {
    stdout.write("No relevant posts detected.\n");
    return;
  }

  stdout.write("Relevant posts:\n");
  for (const report of reports) {
    const feedLabel = report.feedTitle ?? report.feedUrl;
    stdout.write(`- ${feedLabel}\n`);
    for (const post of report.relevantPosts) {
      const reason = post.reason ? ` - ${post.reason}` : "";
      stdout.write(`    - ${post.title} (${post.link})${reason}\n`);
    }
  }
}

function formatShortDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) {
    return "--";
  }

  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)}ms`;
  }

  if (milliseconds < 60_000) {
    const seconds = milliseconds / 1000;
    return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
  }

  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1000);
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export async function main(options: MainOptions = {}): Promise<void> {
  const {
    argv = process.argv.slice(2),
    stdout = process.stdout,
    stderr = process.stderr,
    now = () => Date.now(),
    env = process.env,
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

  if (cliArguments.model) {
    env[MODEL_ENV_VARIABLE] = cliArguments.model;
  }

  const ollamaClient = new OllamaClient();

  try {
    await ollamaClient.checkConnection();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to connect to Ollama";
    stderr.write(`Error: ${message}\n`);
    process.exitCode = 1;
    return;
  }

  const months = cliArguments.months ?? DEFAULT_MONTH_WINDOW;

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

    const verboseEnabled = cliArguments.verbose === true;
    const results = await analyzeFeeds(feeds, {
      parallel: cliArguments.parallel ?? DEFAULT_PARALLEL,
      months,
      dependencies: { analysisClient: ollamaClient },
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
      onVerboseMessage: verboseEnabled
        ? (entry) => {
            const label = entry.feedTitle ?? entry.feedUrl;
            stdout.write(`[VERBOSE] ${label} - ${entry.message}\n`);
          }
        : undefined,
      clock: now,
    });

    const elapsedMs = now() - startedAt;
    const { succeeded, failed, averageDurationMs } = summarize(results);
    const averageText = averageDurationMs !== undefined ? ` avg ${formatShortDuration(averageDurationMs)}` : "";
    stdout.write(
      `Finished ${total} feeds: ${succeeded.length} succeeded, ${failed.length} failed in ${formatDuration(elapsedMs)}${averageText}.\n`,
    );

    if (failed.length > 0) {
      stderr.write("Failed feeds:\n");
      for (const item of failed) {
        const reason = item.error?.message ?? "Unknown error";
        stderr.write(`  - ${item.feedUrl}: ${reason}\n`);
      }
      process.exitCode = 1;
    }

    const reports = buildFeedReports(succeeded);
    if (cliArguments.verbose) {
      logVerboseFindings(reports, stdout);
    }

    const outputTarget = cliArguments.output ?? { format: "json", destination: undefined };

    try {
      if (outputTarget.format === "csv") {
        await emitCsvReport(reports, outputTarget.destination, stdout);
      } else {
        await emitJsonReport(reports, outputTarget.destination, stdout);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to write results";
      stderr.write(`Error: ${message}\n`);
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
