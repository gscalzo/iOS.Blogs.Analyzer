# iOS Blogs Analyzer

A TypeScript CLI that scans the curated `blogs.json` directory of iOS blogs, fetches each RSS/Atom feed, and uses a local Ollama model to highlight posts about AI-powered mobile development.

## Prerequisites

- Node.js 20+
- Ollama running locally with the `llama3.1` or `qwq` model pulled

## Quick Start

```bash
./run.sh install   # install dependencies
./run.sh build     # compile TypeScript -> dist
./run.sh           # run analyzer with defaults
./run.sh test      # run the Vitest suite
```

## CLI Options

| Flag | Description |
| --- | --- |
| `--max-blogs <number>` | Limit the number of feeds processed (useful for smoke tests). |
| `--parallel <number>` | Control concurrency (default 3). |
| `--months <number>` | Only analyze posts from the last N months (default 3). |
| `--model <name>` | Override the Ollama model (`IOS_BLOGS_ANALYZER_MODEL`). |
| `--output [format:]<target>` | Select output format and destination. Leave blank for JSON to stdout, use `csv`/`json` prefixes (e.g., `--output csv:report.csv` or `--output csv` for CSV to stdout). |
| `--verbose` | Print per-feed relevant post summaries. |
| `--help` | Show inline help. |

## Output Formats

- **JSON** (default): structured payload `{ "feeds": [...] }`, written to stdout unless a file path is provided.
- **CSV**: flatten relevant posts per feed with columns `feed_title,feed_url,post_title,post_link,published_at,confidence,tags,reason`. Enabled via `--output csv[:<file>]`.

### Usage Examples

```bash
# Analyze just 5 feeds with verbose summaries and JSON output to disk
./run.sh -- --max-blogs 5 --verbose --output results.json

# Export the last 2 months of posts to CSV and read from stdout
./run.sh -- --months 2 --output csv

# Stress-test concurrency with 5 workers and a different model
IOS_BLOGS_ANALYZER_MODEL=qwq ./run.sh -- --parallel 5 --max-blogs 10
```

### Configuration Notes

- **Ollama model**: defaults to `llama3.1`. Override via `--model <name>` or `IOS_BLOGS_ANALYZER_MODEL`.
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
