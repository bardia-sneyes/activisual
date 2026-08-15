# Security policy

## Supported versions

Security fixes are released on the latest published version of Activisual. Users should update with `activisual@latest` rather than remaining on an older release.

## Reporting a vulnerability

Please do not disclose vulnerabilities or sensitive trace data in a public issue. Use [GitHub private vulnerability reporting](https://github.com/bardia-sneyes/activisual/security/advisories/new) to contact the maintainer privately.

Include the affected version, operating system, harness, reproduction steps, impact, and any suggested mitigation. Remove real API keys, tokens, prompts, and trace contents from the report.

## Security model

Activisual is a localhost-only observability tool, not a sandbox or enforcement boundary. It redacts common secret patterns before persistence, but users should still avoid placing secrets directly in prompts and command arguments.
