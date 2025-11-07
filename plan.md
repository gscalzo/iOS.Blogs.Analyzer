# iOS Blogs Analyzer - Implementation Plan

## Project Overview

Build a TypeScript command-line tool that analyzes iOS blog RSS feeds to identify posts related to AI and mobile development using local Ollama LLM.

## Current Status: 🟡 Phase 2 In Progress

**Last Updated**: 2025-11-07  
**Current Session**: Phase 1 Setup

---

## Implementation Phases

### Phase 1: Project Setup ✅

#### 1.1 Initialize TypeScript Project
- [x] Create `package.json` with project metadata
- [x] Add TypeScript dependencies (`typescript`, `@types/node`, `ts-node`)
- [x] Configure `tsconfig.json` for Node.js
- [x] Add testing framework (Jest or Vitest)
- [x] Create basic project structure:
  ```
  src/
    ├── index.ts          # Main entry point
    ├── types.ts          # Type definitions
    ├── rss-parser.ts     # RSS feed parsing
    ├── ollama-client.ts  # Ollama API integration
    ├── analyzer.ts       # Main analysis logic
    └── utils.ts          # Helper functions
  tests/
    └── *.test.ts         # Test files
  ```

#### 1.2 Create Self-Contained Shell Script
- [x] Create `run.sh` with the following commands:
  - `./run.sh` - Run the analyzer
  - `./run.sh test` - Run test suite
  - `./run.sh build` - Build TypeScript
  - `./run.sh install` - Install dependencies
- [x] Add auto-dependency installation check
- [x] Make script executable (`chmod +x run.sh`)
- [x] Add usage/help documentation

#### 1.3 Initial Test Suite
- [x] Set up test infrastructure
- [x] Write first test (e.g., "project loads successfully")
- [x] Ensure test runner works
- [x] Document how to run tests

**Deliverables**: Working TypeScript project with test framework and run script

---

### Phase 2: RSS Feed Parsing 🔲

#### 2.1 RSS Parser Implementation
- [x] Choose RSS parsing library (`rss-parser` or similar)
- [x] Implement `fetchFeed(url: string)` function
- [x] Parse feed items: title, description, link, pubDate
- [ ] Handle both RSS and Atom formats
- [x] Add error handling for:
  - Network failures
  - Malformed feeds
  - Missing required fields

#### 2.2 Blog Data Loading
- [x] Load `blogs.json` file
- [x] Validate JSON structure against `schema_blogs.json`
- [x] Extract all feed URLs from nested structure
- [ ] Implement `--max-blogs` parameter to limit feeds processed

#### 2.3 Tests
- [x] Test RSS feed parsing with sample feed
- [x] Test blogs.json loading
- [x] Test feed URL extraction
- [x] Test error handling (invalid URLs, network errors)
- [ ] Test max-blogs parameter

**Deliverables**: Robust RSS feed parsing with comprehensive tests

---

### Phase 3: Ollama Integration 🔲

#### 3.1 Ollama Client
- [ ] Implement Ollama HTTP API client
- [ ] Create function: `analyzeText(description: string): Promise<boolean>`
- [ ] Support both `llama3.1` and `qwq` models
- [ ] Add model selection via CLI parameter or env variable
- [ ] Implement connection checking

#### 3.2 Prompt Engineering
- [ ] Design prompt for AI/mobile development detection
- [ ] Test prompt with various blog post descriptions
- [ ] Optimize for accuracy and speed
- [ ] Handle Ollama response parsing

#### 3.3 Error Handling & Retry Logic
- [ ] Detect Ollama connection failures
- [ ] Implement retry mechanism with exponential backoff
- [ ] Set timeout for Ollama requests
- [ ] Graceful degradation if Ollama is unavailable

#### 3.4 Tests
- [ ] Test Ollama client connectivity
- [ ] Test text analysis with mock responses
- [ ] Test retry logic
- [ ] Test error handling
- [ ] Test with both models (llama3.1, qwq)

**Deliverables**: Working Ollama integration with robust error handling

---

### Phase 4: Parallel Processing 🔲

#### 4.1 Concurrency Implementation
- [ ] Implement `--parallel N` CLI parameter
- [ ] Use Promise.all() or async pool for concurrent requests
- [ ] Default parallel value: 3-5 concurrent requests
- [ ] Implement rate limiting to avoid overwhelming Ollama

#### 4.2 Progress Tracking
- [ ] Show progress indicator (e.g., "Processing 5/127 blogs...")
- [ ] Display real-time results (AI/mobile posts found)
- [ ] Estimate time remaining

#### 4.3 Tests
- [ ] Test parallel processing with mock feeds
- [ ] Test that parallelism limit is respected
- [ ] Test progress tracking
- [ ] Test performance with various parallel values

**Deliverables**: Efficient parallel processing with progress tracking

---

### Phase 5: CLI Interface 🔲

#### 5.1 Argument Parsing
- [ ] Implement CLI argument parser (yargs or commander)
- [ ] Arguments:
  - `--parallel <N>` - Number of concurrent requests (default: 3)
  - `--max-blogs <N>` - Maximum blogs to check (optional, for testing)
  - `--model <name>` - Ollama model to use (default: llama3.1)
  - `--output <file>` - Output file for results (default: stdout)
  - `--verbose` - Verbose logging
- [ ] Display help with `--help`

#### 5.2 Output Formatting
- [ ] Format results clearly:
  - Blog title
  - Post title
  - Post link
  - Relevance score/reason
- [ ] Support JSON output format
- [ ] Support CSV export

#### 5.3 Tests
- [ ] Test argument parsing
- [ ] Test output formatting
- [ ] Test various CLI combinations

**Deliverables**: Polished CLI interface with flexible options

---

### Phase 6: Integration & Polish 🔲

#### 6.1 End-to-End Integration
- [ ] Connect all components
- [ ] Test complete workflow:
  1. Load blogs.json
  2. Fetch RSS feeds
  3. Analyze with Ollama
  4. Output results
- [ ] Handle edge cases

#### 6.2 Documentation
- [ ] Update README.md with:
  - Installation instructions
  - Usage examples
  - Configuration options
  - Troubleshooting
- [ ] Add inline code comments
- [ ] Document architecture decisions

#### 6.3 Performance Optimization
- [ ] Profile execution time
- [ ] Optimize bottlenecks
- [ ] Add caching if beneficial
- [ ] Memory optimization for large feeds

#### 6.4 Final Testing
- [ ] Run full test suite
- [ ] Test with real blogs.json data
- [ ] Test with local Ollama instance
- [ ] Verify all CLI parameters work
- [ ] Test error scenarios

**Deliverables**: Production-ready tool with complete documentation

---

## Testing Strategy

### Test Categories
1. **Unit Tests**: Individual functions (RSS parsing, Ollama client, etc.)
2. **Integration Tests**: Combined components (fetch + analyze)
3. **E2E Tests**: Complete workflow with sample data
4. **Error Tests**: Network failures, invalid data, etc.

### Testing Tools
- Jest or Vitest as test runner
- Nock or MSW for HTTP mocking
- Mock Ollama responses for predictable testing

### Test Coverage Goal
- Aim for >80% code coverage
- 100% coverage for critical paths (RSS parsing, Ollama integration)

---

## Dependencies

### Core Dependencies
- `typescript` - Language
- `ts-node` - TypeScript execution
- `rss-parser` - RSS feed parsing
- `node-fetch` or `axios` - HTTP requests
- `yargs` or `commander` - CLI parsing

### Dev Dependencies
- `jest` or `vitest` - Testing framework
- `@types/node` - Node.js types
- `@types/jest` or `@vitest/ui` - Test types
- `eslint` - Linting
- `prettier` - Code formatting

---

## Technical Decisions

### Why TypeScript?
- Type safety reduces bugs
- Better IDE support
- Self-documenting code

### Why Self-Contained Shell Script?
- Easy for users to run without setup
- Handles dependency installation
- Cross-platform compatibility (with bash)

### Why Ollama Local?
- Privacy (no data sent to cloud)
- Cost (no API fees)
- Speed (local inference)
- Offline capability

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Ollama not installed | High | Check and provide clear installation instructions |
| RSS feeds down/broken | Medium | Robust error handling, skip failed feeds |
| Slow Ollama inference | Medium | Parallel processing, progress tracking |
| Large number of feeds | Medium | Implement `--max-blogs` for testing, caching |
| Incorrect AI detection | Low | Prompt engineering, manual review of results |

---

## Success Metrics

- ✅ All tests pass
- ✅ Can process all blogs in blogs.json
- ✅ Correctly identifies AI/mobile posts (>80% accuracy)
- ✅ Runs in reasonable time (<30 min for all feeds)
- ✅ Handles errors gracefully
- ✅ Clear, usable output

---

## Next Steps

1. ✅ Create AGENTS.md ← DONE
2. ✅ Create plan.md ← DONE
3. 🔄 Continue Phase 2 (RSS feed parsing & blog loading)
4. Implement CLI wiring for `--max-blogs` and add corresponding tests
5. Add Atom feed fixture to verify parser coverage

---

## Session Log

### Session 1: 2025-11-07 - Initial Planning
**Status**: ✅ Complete

**Completed**:
- Created AGENTS.md with agent rules and testing protocols
- Created plan.md with detailed implementation plan
- Analyzed blogs.json and schema_blogs.json structure
- Defined phases and deliverables

**Next Session**:
- Start Phase 1: Project Setup
- Initialize TypeScript project
- Create package.json and tsconfig.json
- Set up testing framework

### Session 2: 2025-11-07 - Phase 1 Setup
**Status**: ✅ Complete

**Completed**:
- Initialized TypeScript project with `package.json`, `tsconfig.json`, and Vitest configuration
- Added placeholder module structure under `src/` and smoke test under `tests/`
- Created self-contained `run.sh` (run/test/build/install) with dependency bootstrapping
- Installed dependencies with `npm install --ignore-scripts --loglevel warn`
- Verified test suite via `./run.sh test` (1 test passing)

**Issues Encountered**:
- `npm install` failed due to missing `patch-package`; resolved by re-running with `--ignore-scripts`

**Next Session**:
- Start Phase 2: implement RSS feed loading and validation scaffolding
- Choose RSS parsing library and add dependency
- Add initial tests for feed extraction and schema validation

### Session 3: 2025-11-07 - Phase 2 RSS Groundwork
**Status**: 🔄 In Progress

**Completed**:
- Selected `rss-parser` and implemented robust `fetchFeed` with timeout, validation, and parsing helpers
- Added blog directory loader with AJV schema validation plus feed extraction utilities
- Wrote Vitest suites covering RSS parsing success/error cases and blog data handling fixtures

**Issues Encountered**:
- Node's native `fetch` bypasses nock; switched tests to custom fetch stubs for deterministic behaviour

**Next Session**:
- Expose `--max-blogs` via CLI and cover remaining parameter tests
- Introduce Atom feed fixtures to ensure parser compatibility

---

## Notes

- The blogs.json file contains ~7277 lines with multiple language categories
- Each category has multiple sites with feed_url
- Focus on English language blogs initially
- Consider adding language filter as future enhancement
- RSS feeds may use both RSS and Atom formats
- Some feeds may be inactive or broken - handle gracefully

