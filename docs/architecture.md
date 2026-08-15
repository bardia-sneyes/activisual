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
  -> canvas constellation/lane graph + structured inspector
```

Every adapter is intentionally fire-and-forget. It appends one JSON line and produces no additional context, decisions, or exit failures. Activisual therefore observes the host agent without steering it.

Codex and Claude Code copy a dependency-free Node runtime beside their hook configuration. Pi and OpenCode load JavaScript exports from the npm package. Hermes loads the Python plugin installed under `~/.hermes/plugins/activisual`. The adapters map native event names and payload fields into the same stored envelope.

## Stored event envelope

Every event stores an ID, timestamp, session ID, optional turn ID, event name, project working directory, model, and permission mode. Event-specific fields are limited to what the dashboard needs:

- tool name, tool-use ID, redacted input/response, and permission metadata when available;
- prompt text for user decision points;
- session source/end reason;
- subagent ID/type;
- compaction trigger.

`transcript_path` and raw conversation history are deliberately omitted because the dashboard does not need them.

## Grouping

The reducer pairs `PreToolUse` and `PostToolUse` by `tool_use_id`, yielding one work chunk with start/end timestamps, duration, outcome, structured diff metadata, and permission allowance. Permission requests without a tool-use ID are paired conservatively by turn, tool, and event order. A small deterministic classifier identifies:

- test commands;
- build/typecheck commands;
- git milestones;
- file writes and patches;
- agent branches;
- prompts and approvals.

Ordinary file paths must resolve to existing files inside the tracked project. Diff headers may refer to newly added or deleted paths, so those are admitted without an existence check after project-boundary validation. This keeps prose, MIME types, dates, and log fragments out of the file graph.

The browser offers two deterministic layouts over the same graph model. Constellation mode follows chronology around a square spiral to expose relationships in all directions; lane mode preserves the inspect/change/verify workflow bands. Both use a high-DPI Canvas 2D renderer, bounded device-pixel ratio, viewport culling through clipping, and a live camera that follows the active head without mutating graph data.

## Persistence and retention

JSONL keeps single-project sessions inspectable with ordinary local tools and recoverable when the last line is interrupted. The server reads append-only increments, ignores malformed lines, and performs atomic rewrites for deletion and pruning.

Default retention is 30 days and 50 sessions. Both values are server options internally and can become CLI flags once real usage provides a sensible configuration surface.

## API

- `GET /api/health`
- `GET /api/sessions`
- `GET /api/sessions/:id`
- `GET /api/sessions/:id/export` (downloadable structured trace)
- `DELETE /api/sessions/:id`
- `GET /api/stream` (server-sent events)
- `POST /api/events` (localhost development/test adapter; hook-shaped input is redacted before storage)

All responses include a restrictive content security policy, frame denial, no-referrer policy, and MIME sniffing protection.

## Current limitations

- One explicitly selected project per server.
- Hosted Codex tools that bypass the local function-tool hook path do not appear as tool chunks.
- File relationships are inferred from structured inputs and path-like command text; unusual shell quoting may reduce accuracy.
- JSONL is designed for personal local sessions, not multiple users or high-throughput distributed tracing.
- Patch data is redacted before persistence; individual hook payload strings above 2 MB are intentionally truncated and marked in the diff inspector.
