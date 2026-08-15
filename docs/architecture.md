# Architecture

## Event path

```text
Harness lifecycle event
  -> native adapter (command hook, JavaScript extension, or Python plugin)
  -> redact + compact
  -> .activisual/events.jsonl
  -> localhost server tail
  -> session reducer
  -> JSON API + server-sent events
  -> timeline / canvas graph / replay inspector
```

Every adapter is intentionally fire-and-forget. It appends one JSON line and produces no additional context, decisions, or exit failures. Activisual therefore observes the host agent without steering it.

Codex and Claude Code copy a dependency-free Node runtime beside their hook configuration. Pi and OpenCode load JavaScript exports from the npm package. Hermes loads the Python plugin installed under `~/.hermes/plugins/activisual`. The adapters map native event names and payload fields into the same stored envelope.

## Stored event envelope

Every event stores an ID, timestamp, session ID, optional turn ID, event name, project working directory, model, and permission mode. Event-specific fields are limited to what the dashboard needs:

- tool name, tool-use ID, redacted input, and redacted response;
- prompt text for user decision points;
- session source/end reason;
- subagent ID/type;
- compaction trigger.

`transcript_path` and raw conversation history are deliberately omitted because the dashboard does not need them.

## Grouping

The reducer pairs `PreToolUse` and `PostToolUse` by `tool_use_id`, yielding one work chunk with start/end timestamps, duration, and outcome. A small deterministic classifier identifies:

- test commands;
- build/typecheck commands;
- git milestones;
- file writes and patches;
- agent branches;
- prompts and approvals.

File paths are extracted only when they resolve inside the tracked project. Links to paths outside the project are discarded.

## Persistence and retention

JSONL keeps single-project sessions inspectable with ordinary local tools and recoverable when the last line is interrupted. The server reads append-only increments, ignores malformed lines, and performs atomic rewrites for deletion and pruning.

Default retention is 30 days and 50 sessions. Both values are server options internally and can become CLI flags once real usage provides a sensible configuration surface.

## API

- `GET /api/health`
- `GET /api/sessions`
- `GET /api/sessions/:id`
- `DELETE /api/sessions/:id`
- `GET /api/stream` (server-sent events)
- `POST /api/events` (localhost development/test adapter; hook-shaped input is redacted before storage)

All responses include a restrictive content security policy, frame denial, no-referrer policy, and MIME sniffing protection.

## Current limitations

- One explicitly selected project per server.
- Hosted Codex tools that bypass the local function-tool hook path do not appear as tool chunks.
- File relationships are inferred from structured inputs and path-like command text; unusual shell quoting may reduce accuracy.
- JSONL is designed for personal local sessions, not multiple users or high-throughput distributed tracing.
- Patch data is truncated and redacted before persistence, so the inspector may show only a partial diff.
