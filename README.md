# Activisual

**See what your coding agent is doing—live, locally, and without sending its trace anywhere.**

[![npm](https://img.shields.io/npm/v/activisual?color=71f7a8)](https://www.npmjs.com/package/activisual)
[![CI](https://github.com/bardia-sneyes/activisual/actions/workflows/ci.yml/badge.svg)](https://github.com/bardia-sneyes/activisual/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/Node.js-%3E%3D20-71f7a8)
![Privacy](https://img.shields.io/badge/runtime-local--only-79d9ff)
[![License](https://img.shields.io/badge/license-MIT-f7cb71)](LICENSE)

Activisual turns coding-agent lifecycle events into a readable timeline and relationship graph. It shows prompts, tools, decisions, subagents, tests, builds, git operations, and affected files across **Codex, Claude Code, Pi, OpenCode, and Hermes Agent**.

![Activisual dashboard showing a live trace and work graph](https://raw.githubusercontent.com/bardia-sneyes/activisual/main/docs/dashboard.png)

## Quick start

Activisual requires Node.js 20 or newer. Run these commands from the project you want to observe:

```bash
npx --yes activisual@latest install --harness all
npx --yes activisual@latest start
```

The installer preserves existing configuration and is safe to run more than once. Restart each installed harness before starting a new session. Codex and Claude Code users should also open `/hooks` and review the newly installed lifecycle hooks before trusting them.

The dashboard opens at `http://127.0.0.1:4319`. Trace data stays in `<project>/.activisual/events.jsonl`.

## Install by harness

Installation is project-scoped by default:

| Harness | Command | Configuration |
| --- | --- | --- |
| Codex | `npx --yes activisual@latest install --harness codex` | Adds `.codex/hooks.json` and a dependency-free hook runtime |
| Claude Code | `npx --yes activisual@latest install --harness claude` | Adds hooks to `.claude/settings.json` and copies the hook runtime |
| Pi | `npx --yes activisual@latest install --harness pi` | Adds `npm:activisual` to `.pi/settings.json` |
| OpenCode | `npx --yes activisual@latest install --harness opencode` | Adds `activisual` to the `plugin` list in `opencode.json` |
| Hermes Agent | `npx --yes activisual@latest install --harness hermes` | Installs and enables `~/.hermes/plugins/activisual` |

Aliases `claude-code` and `open-code` are accepted. Use a comma-separated list such as `--harness codex,pi`, or use `--harness all` for every supported harness.

Add `--global` to configure user-wide Codex, Claude Code, Pi, and OpenCode integrations. Hermes plugins are always user-scoped because Hermes loads third-party plugins from the user plugin directory.

```bash
npx --yes activisual@latest install --harness all --global
npx --yes activisual@latest start --project /path/to/project --port 4320
```

### Native installation alternatives

Activisual also includes the manifests and exports used by each harness. The `npx` installer above is the consistent cross-harness route; these native commands are useful when you prefer a harness package manager.

```bash
# Pi: user scope (use -l for project scope)
pi install npm:activisual

# Hermes Agent
hermes plugins install bardia-sneyes/activisual --enable

# Claude Code
claude plugin marketplace add bardia-sneyes/activisual
claude plugin install activisual@activisual
```

Relevant host documentation: [Codex hooks](https://learn.chatgpt.com/docs/hooks), [Claude Code plugins](https://code.claude.com/docs/en/discover-plugins), [Pi packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md), [OpenCode plugins](https://opencode.ai/docs/plugins/), and [Hermes plugins](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/plugins.md).

## What you get

- Session start/end, user prompts, stops, context compaction, and paired tool lifecycle events.
- Builds, tests, git milestones, file reads/writes, permission requests, and subagent branches.
- Full redacted patch payloads (up to 2 MB per captured string), per-file diff statistics, and color-coded diff inspection.
- Human-readable structured tool inputs and responses rather than raw JSON logs.
- Permission mode, request, inferred allowance, decision, risk, and reason fields when a harness exposes them.
- Omni-directional constellation and chronological lane layouts with pan, zoom, fit, live follow, and keyboard inspection.
- Saved sessions with live updates, JSON export, a detail inspector, and explicit deletion.
- One normalized event model across all supported harnesses.

Activisual observes agent activity; it is not a security or enforcement boundary. Event coverage depends on what each harness exposes, and hosted operations that bypass local hooks may not appear.

## Privacy

- Runtime trace data stays on the local machine; Activisual has no telemetry service.
- The dashboard listens on `127.0.0.1` only.
- Secret-bearing keys, bearer tokens, OpenAI-style API keys, private keys, connection strings, and environment values are redacted before persistence.
- Very large strings are capped at 2 MB and collections are bounded. Raw transcripts and transcript paths are not stored.
- Events older than 30 days are pruned at startup, and only the 50 most recent sessions are retained.
- Hook adapters fail open, so Activisual cannot block the host agent when capture is unavailable.

These controls reduce accidental exposure but do not replace a dedicated secret scanner. Avoid placing secrets directly in prompts or command arguments.

## How it works

```text
Harness lifecycle event
  -> native hook or plugin adapter
  -> redact + normalize + append JSONL
  -> localhost server and session reducer
  -> JSON API + server-sent events
  -> live workflow graph + structured inspector
```

Codex and Claude Code use command hooks. Pi and OpenCode load JavaScript adapters from the npm package. Hermes loads the packaged Python plugin. Every adapter writes the same compact event envelope.

See [Architecture](docs/architecture.md) for the storage model, grouping rules, API, and current limitations.

## Command reference

```text
activisual install [--harness NAME|all] [--project PATH] [--global]
activisual start [--project PATH] [--port 4319] [--no-open]
```

`install` defaults to Codex. `start` defaults to the current directory and opens a browser unless `--no-open` is supplied.

## Troubleshooting

If the dashboard does not show a new session:

1. Confirm that `activisual start` is running for the same project directory used by the agent.
2. Restart the harness after installation.
3. In Codex or Claude Code, open `/hooks` and confirm that the Activisual hooks are trusted and enabled.
4. Run the harness installer again; it is idempotent and preserves unrelated configuration.

## Contributing

Issues and pull requests are welcome. See the [contribution guide](https://github.com/bardia-sneyes/activisual/blob/main/CONTRIBUTING.md) for the development workflow, [governance policy](https://github.com/bardia-sneyes/activisual/blob/main/GOVERNANCE.md) for how project decisions are made, and [security policy](https://github.com/bardia-sneyes/activisual/blob/main/SECURITY.md) for private vulnerability reporting. Participation is governed by the [code of conduct](https://github.com/bardia-sneyes/activisual/blob/main/CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
