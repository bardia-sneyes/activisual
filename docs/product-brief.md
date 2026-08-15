# Project overview

## Purpose

Activisual is a local-first visual companion for agentic coding. It makes a live session understandable at a glance through a browser dashboard instead of forcing the user to reconstruct progress from raw tool logs.

## Supported harnesses

- Codex command hooks and native plugin manifest
- Claude Code command hooks and native plugin manifest
- Pi npm extension
- OpenCode npm plugin
- Hermes Agent Python plugin

All integrations normalize their lifecycle events into one compact internal schema. A single idempotent CLI installer can configure one harness, several harnesses, or all supported harnesses at project or user scope where the host permits it.

## What users see

- Tool starts and finishes, durations, outcomes, errors, builds, tests, git milestones, and agent state.
- Files read or changed and links between commands and affected files.
- User prompts, approvals, steering, and interventions as prominent decision points.
- Compact nodes focused on metadata and concise summaries, with detail available in the inspector.
- Saved sessions, live updates, replay, and explicit deletion.

## Privacy and resilience

Everything stays local by default: no telemetry, cloud storage, or external transfer. Events are redacted and bounded before persistence. Hooks fail open so missing or broken visualization can never block the host agent.

## Distribution

Activisual is an npm CLI and extension package. It also carries the native manifests used by Codex, Claude Code, and Hermes plugin systems. Continuous integration verifies the adapters and package contents across supported Node releases and operating systems; matching version tags trigger npm and GitHub releases with provenance.

## Current limitations

- One explicitly selected project per dashboard server.
- Event coverage differs by harness; the trace is not an enforcement or audit boundary.
- File relationships are inferred from structured inputs and path-like text.
- JSONL storage is intended for personal local sessions, not multi-user distributed tracing.
