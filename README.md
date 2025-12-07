# iOS Blogs Analyzer

An opinionated TypeScript CLI for iOS developers who want a daily radar on AI innovation. It downloads the latest `blogs.json` from Dave Verwer’s [iOS Dev Directory](https://iosdevdirectory.com) (repo: https://github.com/daveverwer/iOSDevDirectory — Dave also publishes [iOS Dev Weekly](https://iosdevweekly.com/)), fetches every RSS/Atom feed, and pipelines each post through a local Ollama model so you instantly see which articles move the needle for AI/ML-powered mobile work. With configurable language/category filters, CSV/JSON exports, failure-retry support, and verbose telemetry, it’s a self-hosted newsroom tailored to your iOS + AI interests.

## Prerequisites

- Node.js 20+
- Ollama running locally with your desired model pulled (e.g., `llama3.1`, `qwq`, `deepseek-r1:8b`, etc.)

## Quick Start

```bash
./run.sh install   # install dependencies
./run.sh build     # compile TypeScript -> dist
./run.sh -- --model llama3.1  # run analyzer (model is required)
./run.sh test      # run the Vitest suite
```

## CLI Options

| Flag | Description |
| --- | --- |
| `--max-blogs <number>` | Limit the number of feeds processed (useful for smoke tests). |
| `--parallel <number>` | Control concurrency (default 3). |
| `--months <number>` | Only analyze posts from the last N months (default 3). |
| `--model <name>` | Required: choose the Ollama model (any local model/tag, e.g., `llama3.1`, `qwq`, `deepseek-r1:8b`). |
| `--output [format:]<target>` | Select output format and destination. Formats: `json`, `csv`, `md`. Leave blank for JSON to stdout; use `csv:`/`md:` prefixes to write files (e.g., `--output csv:report.csv`, `--output md:notes.md`). If `md` has no file, a dated `blogs-ai-list-YYYY-MM-DD.md` is created. |
| `--verbose`, `-v` | Print per-feed relevant post summaries and step-by-step analysis logs. |
| `--failed-log <file>` | Save failed feed URLs (and their errors) to a JSON file for later retries. |
| `--perf-log <file>` | Persist per-feed performance metrics (durations, analyzed item counts, statuses) to a JSON file for benchmarking. |
| `--retry-file <file>` | Skip `blogs.json` and analyze the feed URLs from a previous failed-log JSON file. |
| `--help` | Show inline help. |

## Output Formats

- **JSON** (default): structured payload `{ "feeds": [...] }`, written to stdout unless a file path is provided.
- **CSV**: flatten relevant posts per feed with columns `feed_title,feed_url,post_title,post_link,published_at,confidence,tags,reason`. Enabled via `--output csv[:<file>]`.

### Usage Examples

```bash
# Pull the latest directory (run.sh handles this automatically), analyze 5 feeds with verbose summaries, and write JSON
./run.sh -- --max-blogs 5 --verbose --output results.json --model llama3.1

# Export the last 2 months of posts to CSV and read from stdout
./run.sh -- --months 2 --output csv --model llama3.1

# Stress-test concurrency with 5 workers and a different model
./run.sh -- --parallel 5 --max-blogs 10 --model qwq

# Force a specific model just for this run
./run.sh -- --model llama3.1:8b --max-blogs 5

# Save an Obsidian-ready markdown list with checkboxes
./run.sh -- --max-blogs 10 --output md --model llama3.1

# Capture per-feed performance metrics for later analysis
./run.sh -- --max-blogs 25 --parallel 5 --perf-log perf-log.json --model llama3.1
```

### Configuration Notes

- **Ollama model**: required. Provide via `--model <name>` (any local model/tag such as `llama3.1`, `llama3.1:8b`, `qwq`, `deepseek-r1:8b`). The value is forwarded directly to the Ollama client for every request.
- **Model precedence**: The CLI argument is the single source of truth; no environment fallback is used.
- **Tagged models & detection**: The CLI fetches `/api/tags` and will reuse your installed model names as-is. If you specify an untagged prefix and only a tagged variant exists, the client will pick the installed tag automatically.
- **False-positive guardrails**: Posts are only kept when the model marks them relevant *and* AI/ML signals are present (keywords/tags/reason). This reduces accidental matches like generic Swift Charts articles.
- **Markdown output**: `--output md[:file]` writes a checkbox list suitable for Obsidian. If no file is provided, a dated filename like `blogs-ai-list-YYYY-MM-DD.md` is created automatically.
- **Verbose mode**: `--verbose`/`-v` announces how many posts fall within the month window for each feed and logs every item as it is handed to Ollama, then prints the final relevant-post summary.
- **Failure retries**: Pass `--failed-log failed-feeds.json` to capture any feed errors (the file includes both `failedFeeds` and the full success payload). Later you can re-run just those feeds with `--retry-file failed-feeds.json`, which is handy if you need to process them on another machine or with a different network setup.
- **Performance benchmarking**: Use `--perf-log perf.json` to dump per-feed durations, analyzed counts, and status/error data so you can compare different `--parallel`, `--months`, or filtering combinations over time.
- **Language & category filtering**: Edit `config/filter-config.json` to control which languages and category titles are allowed. By default only the English (`"en"`) group is processed; the `allowedCategories` list acts as an allow-list—delete entries to exclude categories from future runs.
- **Blog subset**: `--max-blogs` is the fastest way to run smoke tests without touching the huge `blogs.json`.
- **Time window**: `--months` controls the cutoff for `publishedAt` filtering before any Ollama calls fire, keeping the session cost down.
- **Parallelism**: The async pool is capped by `--parallel` (default 3) to avoid overwhelming local Ollama.
- **Output path**: Use `--output csv:/tmp/report.csv` or `--output results.json`. Omit the destination to stream to stdout.

## Troubleshooting

| Symptom | Likely Cause | Fix |
| --- | --- | --- |
| `Error: Unable to connect to Ollama` | Ollama daemon not running or model not pulled. | Run `ollama serve` and `ollama pull llama3.1` (or `qwq`). Re-run the analyzer. |
| Feed fetch timeouts | RSS endpoint slow/unreachable. | Re-run with `--max-blogs` to isolate, or adjust `fetchOptions` in code if needed. Failures are logged under "Failed feeds". |
| Empty CSV/JSON outputs | No relevant posts met the month window or model threshold. | Increase `--months`, inspect verbose output (`--verbose`) to confirm which feeds were evaluated. |
| Memory pressure on large runs | Too many concurrent feeds or results kept in memory. | Lower `--parallel` or use `--max-blogs` to chunk execution. The feed cache avoids refetching duplicate URLs. |

## Architecture Overview

High-level responsibilities are described in [`ARCHITECTURE.md`](ARCHITECTURE.md). In short:

- `src/blogs.ts` loads and normalizes the curated directory.
- `src/rss-parser.ts` fetches + parses feeds with strict error reporting.
- `src/analyzer.ts` orchestrates concurrency, month filtering, Ollama analysis, and feed caching.
- `src/index.ts` wires the CLI, argument parsing, progress reporting, and report emission (JSON/CSV).
- `tests/` mirrors those layers with focused unit suites plus end-to-end coverage (`tests/e2e-cli.test.ts`).

## Testing Scope

The Vitest suite exercises RSS parsing edge cases, Ollama retry logic, concurrency controls, CLI argument validation, CSV/JSON output generation, and an end-to-end pipeline that mocks Ollama responses while using real feed parsing.

## Data Source

The feed directory comes directly from Dave Verwer's [iOS Dev Directory](https://iosdevdirectory.com) (code on GitHub: https://github.com/daveverwer/iOSDevDirectory). Dave also publishes [iOS Dev Weekly](https://iosdevweekly.com/) and curates the directory continuously, so we download a fresh `blogs.json` before each run to stay current.
