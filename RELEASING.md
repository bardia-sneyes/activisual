# Releasing Activisual

This document is for project maintainers. It is intentionally excluded from the npm package.

## Release authentication

The npm package uses trusted publishing with GitHub Actions OIDC. The trusted publisher must allow `npm publish` for:

- Package: `activisual`
- Repository: `bardia-sneyes/activisual`
- Workflow file: `release.yml`

The release workflow has `id-token: write`, runs on a GitHub-hosted runner, and publishes the public package with provenance. Do not add an `NPM_TOKEN` secret.

## Prepare a release

Use the same version in each of these files:

- `package.json`
- `package-lock.json`
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `.codex-plugin/plugin.json`
- `plugin.yaml`

Then run:

```bash
npm run verify
npm publish --dry-run --provenance=false
```

The local dry run disables provenance because provenance is generated only inside the trusted GitHub Actions environment.

## Publish

Commit and push the release, then create an annotated tag that exactly matches `package.json`:

```bash
git tag -a vX.Y.Z -m "Activisual X.Y.Z"
git push origin main
git push origin vX.Y.Z
```

The tag-driven workflow validates the version, runs the test suite, builds the tarball, publishes to npm, and creates a GitHub release containing that tarball.
