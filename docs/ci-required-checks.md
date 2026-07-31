# Required checks on `main`

`main` is protected in GitHub's repository settings, not in this repository. That protection —
which status checks a pull request must pass, whether the branch must be up to date first, whether
an approving review is required, whether administrators are bound by the same rule, and whether
force-pushes or deletions are allowed — is configuration GitHub stores server-side. Nothing under
`.github/` describes it directly, so a contributor reading a checkout could not previously tell
what a pull request had to satisfy, and a workflow or job rename could silently detach a required
context: the check simply stops appearing on pull requests while branch protection keeps waiting on
a name nothing produces anymore.

`.github/branch-protection.main.json` is the committed record. It mirrors the fields
`GET /repos/{owner}/{repo}/branches/{branch}/protection` returns, so a change to branch protection
shows up as a diff to that file instead of as a surprise the next time someone reads the GitHub
settings page.

**Recording this is not enforcing it.** This repository has no authority to change branch
protection, and nothing here does. `scripts/check-required-checks.ts` only reads the live
protection state (`gh api repos/{owner}/{repo}/branches/{branch}/protection`, a read-only endpoint)
and compares it against the committed manifest; it never calls an endpoint that could change
protection. Run it by hand whenever branch protection may have moved:

```sh
pnpm ci:check-required-checks
```

Reading branch protection requires admin permission on the repository, which the default
`GITHUB_TOKEN` a pull request runs with does not have — that is why this check is a manual,
`gh`-authenticated command rather than a step in `pnpm quality` or a required workflow. If it
reports drift, update `.github/branch-protection.main.json` to match what an administrator
confirms is intended, or ask an administrator to correct branch protection to match this file — the
script only tells you the two disagree, not which one is right.

## The current required contexts

As recorded in `.github/branch-protection.main.json`, the 8 status checks `main` requires, and the
workflow and job that publish each one:

| Required context                   | Workflow                                                                                               | Job                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------- |
| `Verify workspace`                 | `.github/workflows/ci.yml`                                                                             | `verify`            |
| `Migrate an empty database`        | `.github/workflows/ci.yml`                                                                             | `migration-smoke`   |
| `Integration and end-to-end tests` | `.github/workflows/ci.yml`                                                                             | `system-tests`      |
| `Build container`                  | `.github/workflows/container.yml`                                                                      | `build`             |
| `Secret scan`                      | `.github/workflows/security.yml`                                                                       | `secret-scan`       |
| `CodeQL`                           | `.github/workflows/security.yml`                                                                       | `codeql`            |
| `Dependency review`                | `.github/workflows/security.yml`                                                                       | `dependency-review` |
| `Restore, upgrade, and rollback`   | `.github/workflows/recovery.yml` (or its path-filtered stand-in `.github/workflows/recovery-skip.yml`) | `lifecycle`         |

Branch protection also currently requires the branch be up to date before merging (`strict:
true`), binds administrators to the same rule (`enforce_admins: true`), and disallows force-pushes
and branch deletion. It does not require an approving review count above zero. All of these are
recorded in the manifest alongside the contexts.

## `Classify changes` is not a required context

Two workflows publish a job named `Classify changes`: the path classifier in
`.github/workflows/ci.yml` and, until this document was added, an identically named job in
`.github/workflows/container.yml`. Two jobs publishing the same check name meant `Classify changes`
appeared twice on every pull request, and if it had ever been made a required context, which job
satisfied it would have been ambiguous — one workflow's pass could mask the other's absence.

It is not in the table above, and never has been: `.github/branch-protection.main.json` lists
exactly the 8 contexts branch protection requires, and `Classify changes` is not one of them. That
made the rename in `.github/workflows/container.yml` — to `Classify changes (container)` — safe:
renaming a job that is a required context would detach that context the way the introduction to
this document describes, but this one is not, so nothing in branch protection needed to change
alongside the workflow. Every published check name now maps to exactly one job.

## When a workflow changes

If you rename a job whose `name:` matches one of the 8 contexts in the table above, or move it to a
different workflow file, branch protection keeps waiting on the old name and the pull request can
never satisfy it. Update `.github/branch-protection.main.json` to the new name and have an
administrator update branch protection to match — in that order, so the manifest documents the
intended state before it is applied. `pnpm ci:check-required-checks` confirms afterward that the
two agree again.
