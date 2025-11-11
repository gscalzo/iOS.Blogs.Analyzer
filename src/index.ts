import { extractFeedUrls, loadBlogs } from "./blogs.js";

export interface CliArguments {
  maxBlogs?: number;
  helpRequested?: boolean;
  parallel?: number;
}

export interface MainOptions {
  argv?: string[];
  stdout?: { write(message: string): unknown };
  stderr?: { write(message: string): unknown };
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

export async function main(options: MainOptions = {}): Promise<void> {
  const {
    argv = process.argv.slice(2),
    stdout = process.stdout,
    stderr = process.stderr,
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