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

## Testing Scope

The Vitest suite exercises RSS parsing edge cases, Ollama retry logic, concurrency controls, CLI argument validation, CSV/JSON output generation, and an end-to-end pipeline that mocks Ollama responses while using real feed parsing.

