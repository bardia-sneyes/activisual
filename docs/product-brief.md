# Activisual — Product Brief

## Product intent

Activisual is a local-first visual companion for people using Codex. Its MVP makes one live Codex session understandable at a glance through a browser dashboard, rather than requiring users to infer progress only from text updates. The project is private for now, with an eventual open-source release in mind.

## MVP

- A standalone terminal command starts a local server when a tracked Codex project runs and automatically opens the dashboard when the session starts.
- Lifecycle hooks around Codex tool calls feed the dashboard in real time. Codex is the only supported agent in the MVP; Claude Code may follow later.
- The dashboard combines a cinematic, polished “hacker-panel” timeline/trace with a graph of work, files, and relationships.
- It presents compact, meaningful work chunks rather than every raw tool request and response.

## What users see

- Tool starts, finishes, durations, outcomes, errors, builds/tests, git milestones, and applicable agent/task state.
- Files read or changed, links between commands and affected files, and dynamic branches of work.
- Clear success and failure states: completed work is green; failures are red.
- User questions, answers, steering, and interventions as prominent decision points in both the timeline and graph.
- Compact nodes focused on metadata, connections, and concise summaries. Opening a node reveals metadata and a short summary; deeper expansion can show the associated full diff.

## Privacy and persistence

Everything stays local by default: no telemetry, cloud storage, or external transfer. Sessions are saved locally for later replay, with clear deletion controls and a possible retention limit. Irrelevant or sensitive details should be redacted from the visualization.

## Out of scope for the MVP

- Claude Code support.
- npm/npx installation guidance and Codex plugin distribution.
- A general embedded view inside Codex; optional MCP-based UI compatibility is future scope.

## Open questions

- Which Codex lifecycle hooks and event payloads are available and reliable enough for the first integration?
- What redaction rules and retention defaults best balance useful replay with local privacy?
- What grouping rules most accurately turn granular tool activity into meaningful work chunks?
- Should the initial standalone command target one project/session explicitly, or discover the active Codex session automatically?
