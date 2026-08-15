import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

const root = path.resolve(import.meta.dirname, '..');
const yamlFiles = [
  '.github/dependabot.yml',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
  '.github/ISSUE_TEMPLATE/question.yml',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
];

const parsed = new Map();
for (const file of yamlFiles) {
  const source = await fs.readFile(path.join(root, file), 'utf8');
  parsed.set(file, parse(source));
}

for (const workflowFile of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
  const workflow = parsed.get(workflowFile);
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) {
      if (!step.uses) continue;
      assert.match(
        step.uses,
        /^[^@]+@[a-f0-9]{40}$/,
        `${workflowFile} must pin ${step.uses} to a full commit SHA`,
      );
    }
  }
}

const dependabot = parsed.get('.github/dependabot.yml');
assert.equal(dependabot.version, 2);
assert.deepEqual(
  new Set(dependabot.updates.map((update) => update['package-ecosystem'])),
  new Set(['npm', 'github-actions']),
  'Dependabot must cover npm and GitHub Actions',
);

const codeowners = await fs.readFile(path.join(root, '.github/CODEOWNERS'), 'utf8');
assert.match(codeowners, /^\* @bardia-sneyes$/m, 'CODEOWNERS must keep final review with the maintainer');

for (const file of ['CODE_OF_CONDUCT.md', 'CONTRIBUTING.md', 'GOVERNANCE.md', 'SECURITY.md']) {
  await assert.doesNotReject(fs.access(path.join(root, file)), `Missing community health file: ${file}`);
}

console.log('Repository workflows, dependency updates, templates, and governance files are consistent.');
