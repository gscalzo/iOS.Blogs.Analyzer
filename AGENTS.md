# AI Agent Rules for iOS Blogs Analyzer

## Core Responsibilities

### 1. Test-Driven Development
- **BEFORE** making any code changes, run the existing test suite
- **AFTER** every change, run all tests to ensure they pass
- Add new tests for every new feature or bug fix
- A session is considered **SUCCESSFUL** only if:
  - New tests are added to the test suite
  - ALL tests pass

### 2. Plan-Driven Development
- **ALWAYS** read `plan.md` before starting work
- Identify the next incomplete step in the plan
- Follow the plan sequentially unless explicitly instructed otherwise
- Update `plan.md` after each session with:
  - Completed steps (marked as ✅)
  - In-progress steps (marked as 🔄)
  - Issues encountered
  - Next steps

### 3. Testing Protocol
- Run tests using the command: `./run.sh test` (once implemented)
- If tests fail, diagnose and fix before proceeding
- Use `tmux` if needed for monitoring long-running tests
- Test coverage should include:
  - RSS feed parsing
  - Ollama integration
  - Parallel processing
  - Command-line argument parsing
  - Error handling

### 4. Code Quality Standards
- Keep code self-contained and minimal dependencies
- Use TypeScript for type safety
- Follow modular design principles
- Include inline documentation for complex logic
- Handle errors gracefully with meaningful messages

### 5. Session Workflow
1. Read `plan.md` to understand context and next steps
2. Run existing test suite
3. Implement the planned feature/fix
4. Write tests for the new functionality
5. Run all tests and ensure they pass
6. Update `plan.md` with progress
7. Commit changes with descriptive messages

### 6. Communication
- Report test results clearly (passed/failed counts)
- Explain any deviations from the plan
- Highlight any blockers or technical decisions needed
- Provide clear next steps at end of session

## Project-Specific Rules

### Ollama Integration
- Use locally available models: `llama3.1` or `qwq`
- Handle Ollama connection failures gracefully
- Implement retry logic for API calls
- Use appropriate prompts for AI/mobile development detection

### Parallel Processing
- Respect the `--parallel` command-line parameter
- Implement proper concurrency controls
- Avoid overwhelming Ollama with too many concurrent requests
- Use sensible defaults (e.g., 3-5 concurrent requests)

### RSS Feed Processing
- Parse RSS/Atom feeds robustly
- Handle malformed feeds gracefully
- Extract relevant fields: title, description, link, date
- Respect the `--max-blogs` parameter for testing

### Shell Script Requirements
- The `run.sh` script should be self-contained
- Auto-install dependencies if missing
- Provide clear usage instructions
- Support commands: `run`, `test`, `build`

## Success Criteria

A session ends successfully when:
- ✅ All existing tests pass
- ✅ New tests have been added
- ✅ New functionality works as expected
- ✅ `plan.md` has been updated
- ✅ Code is committed with clear messages

## Failure Protocol

If tests fail:
1. **DO NOT** proceed with new features
2. Diagnose the failure
3. Fix the failing tests
4. Re-run the entire test suite
5. Only continue when all tests pass

## Version Control

- Commit frequently with descriptive messages
- Use conventional commit format:
  - `feat:` for new features
  - `fix:` for bug fixes
  - `test:` for test additions
  - `docs:` for documentation
  - `refactor:` for code refactoring

## Dependencies Management

- Minimize external dependencies
- Document all required dependencies in `package.json`
- Ensure `run.sh` can bootstrap the project from scratch
- Use stable, well-maintained packages

---

**Remember**: No session is complete without passing tests! 🧪✅
