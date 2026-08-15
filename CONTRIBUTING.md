# Contributing to Activisual

Thanks for helping improve Activisual. Bug reports, documentation corrections, new harness adapters, and focused code changes are welcome.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Project decisions and maintainer responsibilities are described in [GOVERNANCE.md](GOVERNANCE.md).

## Development setup

Activisual requires Node.js 20 or newer.

```bash
npm install
npm run verify
npm pack --dry-run
```

`npm run verify` performs syntax checks, integration and configuration matching tests, server tests, and package-manifest validation. CI runs the same checks on Node.js 20, 22, and 24 on Linux and Windows.

For local CLI development:

```bash
npm link
activisual --help
```

## Pull requests

- Fork the repository, create a focused branch, and open a pull request against `main`.
- Keep changes focused and preserve existing user configuration during installation.
- Add or update tests for observable behavior changes.
- Keep lifecycle adapters fail-open so dashboard capture cannot block an agent.
- Do not add telemetry or send trace data away from the local machine.
- Run `npm run verify` before opening a pull request.
- Complete the pull request template and respond to review feedback. A maintainer review is required before merging.

Release operations are documented separately in [RELEASING.md](RELEASING.md) for maintainers.
