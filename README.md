# Activisual

Activisual is a local-first live dashboard for Codex sessions. It turns lifecycle events into a compact, inspectable map connecting commands, decisions, agents, permissions, diffs, and files.

![Local-only](https://img.shields.io/badge/data-local--only-71f7a8)
![Node](https://img.shields.io/badge/node-%3E%3D20-79d9ff)

## Try it

Activisual has no runtime dependencies. From this repository:

```bash
npm install
npm run check
npm test
npm link
```

Install the lifecycle hooks in the project you want to observe:

```bash
cd /path/to/your/project
activisual install
```

Codex requires you to review new or changed project hooks. Start Codex and use `/hooks` to inspect and trust the Activisual hook definitions. Then start the dashboard:

```bash
activisual start
```

The dashboard binds to `127.0.0.1:4319` and opens in your browser. Use `--port`, `--project`, or `--no-open` to change those defaults.

## What the MVP captures

- Session start/end, user prompts, stops, and context compaction
- Tool start/finish pairs, durations, outcomes, and permission requests
- Builds, tests, git milestones, file reads/writes, and subagent branches
- Full redacted patch payloads (up to 2 MB per captured string), per-file diff statistics, and color-coded diff inspection
- Human-readable structured tool inputs and responses rather than raw JSON logs
- Permission mode, request, inferred allowance, decision, risk, and reason fields when hooks expose them
- Omni-directional constellation and chronological lane layouts with pan, zoom, fit, live follow, and keyboard inspection
- Saved sessions with live updates, JSON export, inspection, and explicit deletion

Activisual groups `PreToolUse` and `PostToolUse` events using Codex's `tool_use_id`. Tests, builds, git operations, file edits, decisions, and agent branches receive distinct work-chunk types; everything else remains a compact generic tool chunk.

## Privacy defaults

- The hook writes only to `<project>/.activisual/events.jsonl` with user-only file permissions where supported.
- The server listens on localhost. There is no telemetry, remote storage, or external request in the runtime.
- Common secret keys, bearer tokens, OpenAI-style API keys, private keys, connection strings, and secret-bearing environment assignments are redacted before persistence.
- Very large strings are capped at 2 MB and collections are bounded. Transcript paths and full Codex transcripts are not stored.
- Events older than 30 days are pruned when the server starts, and only the 50 most recent sessions are retained.
- The dashboard's delete button permanently removes one session from the local event log.

These rules reduce accidental exposure; they are not a general-purpose secret scanner. Avoid placing secrets directly in prompts or command arguments.

## Design decisions

The MVP tracks one explicit project per server. Project-local hooks are reliable and keep capture scope understandable; automatic discovery can be added after the single-project path has been exercised in real sessions. Hook scripts fail open and do not make HTTP calls, so a stopped dashboard never blocks Codex.

Current Codex hooks cover local function tools, shell commands, `apply_patch`, and MCP tools. Hosted tools such as web search are not currently observable through `PreToolUse`/`PostToolUse`, so the graph is intentionally a useful trace rather than a complete enforcement or audit boundary. See the current [Codex Hooks documentation](https://learn.chatgpt.com/docs/hooks).

More implementation detail lives in [docs/architecture.md](docs/architecture.md).
