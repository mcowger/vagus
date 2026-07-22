# Agent Guidelines & Session Protocols

## Live Tests Protocol

- **Explicit Approval Required**: Executing live integration tests (e.g. `bun run test:live` or commands with `RUN_LIVE_TESTS=1`) is strictly prohibited without explicit user approval each and every time.

## Subagent Parallel Execution

- **Batch Subagent Dispatch**: When executing independent parallel tracks using subagents, ALL `task` tool calls MUST be invoked concurrently in the **same message turn**.
- **Do Not Serialise Spawns**: Calling `task` for one subagent in Turn N, waiting for its result, and calling `task` for another subagent in Turn N+1 executes tasks sequentially rather than in parallel. Always issue all `task` invocations in a single response turn when parallel execution is required.
