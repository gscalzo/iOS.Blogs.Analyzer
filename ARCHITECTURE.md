# Architecture Overview

## Components

- **CLI (`src/index.ts`)** – Parses arguments, configures the Ollama client, streams progress updates, and hands results off to the report emitters (JSON/CSV).
- **Blogs Directory Loader (`src/blogs.ts`)** – Validates `blogs.json` against `schema_blogs.json`, normalizes URLs (adds schemes), and extracts feed URLs with optional limits.
- **RSS Parser (`src/rss-parser.ts`)** – Wraps `rss-parser`, adds a fetch timeout, and normalizes item metadata (title/link/description/publishedAt).
- **Analyzer (`src/analyzer.ts`)** – Runs the async pool, enforces the month cutoff, caches feed fetches, and coordinates Ollama analysis with retry-aware clients.
- **Ollama Client (`src/ollama-client.ts`)** – Handles HTTP calls, retries, graceful degradation, and structured analysis tagging.
- **Reports (`src/index.ts`)** – Builds per-feed relevant post summaries which are written as JSON or CSV.

## Data Flow

1. CLI loads `blogs.json` and extracts feed URLs (optionally limited via `--max-blogs`).
2. `analyzeFeeds` iterates feeds through an async pool capped by `--parallel`.
3. For each feed:
   - `fetchFeed` retrieves RSS/Atom XML with timeout protection.
   - Feed items are filtered by the month window and description presence.
   - Each eligible item is analyzed by the Ollama client (with retries/backoff baked in).
   - Relevant posts are collected for reporting.
4. Progress callbacks stream `[completed/total]` status + ETA to stdout.
5. When processing finishes, `buildFeedReports` summarizes relevant posts for JSON/CSV output.

## Concurrency & Performance

- The async pool keeps at most `--parallel` feeds in-flight.
- Feed fetches are cached (`Map<string, ParsedFeed>`) with shared in-flight promises so duplicate URLs never hit the network twice per run.
- The analyzer records per-feed durations and average timing, surfaced in the CLI summary.
- Month filtering occurs before any Ollama invocation, minimizing unnecessary LLM calls.

## Testing Strategy

- **Unit**: Utilities, RSS parsing, blogs loading, analyzer behavior, and Ollama client.
- **Integration**: `tests/integration.test.ts` validates RSS parsing + analysis with fixtures.
- **CLI E2E**: `tests/e2e-cli.test.ts` runs the real CLI pipeline (mocked Ollama + fetch) to verify JSON/CSV emission and progress logs.
- **Smoke**: CLI argument parsing and controller behaviors with module-level mocks.

## Future Enhancements

- Run-time flag for alternate blogs directory (useful for experiments without editing `blogs.json`).
- Optional persistence of analysis results to avoid re-analyzing the same posts across runs.
- Additional exporters (Markdown, HTML) built atop the `buildFeedReports` structure.
