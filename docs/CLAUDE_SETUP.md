# Claude GitHub Integration Setup

This setup connects Claude to MATRIX 24 as a staging engineer and independent reviewer. It does not grant Claude production deployment authority.

## 1. Install the official Claude GitHub App

Install the official Claude GitHub App and grant it access only to:

`55c8ck9mgp-maker/matrix24-media`

Repository admin access is required for installation.

## 2. Configure Anthropic authentication

Current MATRIX 24 method: Claude Pro / Claude Code OAuth token.

Generate the token locally with:

```bash
claude setup-token
```

In GitHub:

```text
matrix24-media
-> Settings
-> Secrets and variables
-> Actions
-> New repository secret
```

Create:

```text
Name: CLAUDE_CODE_OAUTH_TOKEN
Value: <paste directly in GitHub; never place it in issues, PRs, code, or chat>
```

Do not commit or expose the token.

## 3. Protect main without breaking production

MATRIX 24 currently has an active ruleset on the default branch that prevents branch deletion and non-fast-forward updates.

Do **not** require all changes to `main` to come through pull requests yet. The production Auto Publisher currently persists queue/state updates directly to the repository, so a blanket PR-only rule could interrupt the autonomous publication path.

Current policy:

- keep deletion and force-push protection active,
- Claude must work only on `claude/*` branches,
- Claude must not commit directly to `main`,
- Claude must not merge pull requests,
- do not strengthen `main` to PR-only until the Auto Publisher write path has either a verified bypass or is moved to a compatible architecture.

The goal is to protect production without blocking its existing autonomous state writes.

## 4. Review PR #1

Review the draft PR:

`Phase 2: Claude staging collaboration framework`

Confirm that it contains only collaboration infrastructure, documentation, workflow configuration, and isolated test-fixture scaffolding.

It must not modify:
- production `queue/`,
- Auto Publisher,
- production Cloudflare deployment,
- social publishing state.

## 5. Merge only after setup validation

The Claude workflow is stored in:

`.github/workflows/claude-review.yml`

Issue/comment triggers use `@claude`.

Claude-created branches use the `claude/` prefix.

Before merge, verify the workflow syntax and authentication input against the current official Claude Code Action.

## 6. First smoke test

After merge, create a GitHub issue using the Claude task template.

Use a non-production task such as:

```text
@claude

Read CLAUDE.md and the docs directory.
Do not modify production code or queue files.
Review the MATRIX 24 collaboration framework and report any missing safeguards.
If you propose documentation improvements, make them only on a claude/* branch and open a PR.
```

Expected result:
- Claude responds on the issue,
- no production state changes,
- any edits are isolated to a `claude/*` branch/PR.

## 7. First engineering task

Only after the smoke test passes:

Ask Claude to prepare a reproducible backup/versioned representation of Worker v3.2.0 in staging, without deploying it.

ChatGPT then independently reviews the result before any production change.

## Security rules

- Never expose Anthropic credentials in chat.
- Never place credentials in GitHub files.
- Keep GitHub Actions full-output/debug logging disabled unless deliberately troubleshooting in a controlled environment.
- Claude must not edit production queue records.
- Claude must not deploy production or merge to main.

## Open safeguard gaps (tracked, not yet resolved)

Identified during smoke-test review of the collaboration framework. These are process/config gaps, not code or queue changes, so they are recorded here for ChatGPT/human follow-up rather than fixed directly:

- **Trigger authorization:** `.github/workflows/claude-review.yml` fires for any `issue_comment`/`issues` event whose body contains `@claude`, with no check on `github.event.comment.author_association` (or `github.event.issue.author_association`). Any user able to comment on or open an issue can invoke the workflow, which holds `contents: write`, `pull-requests: write`, `issues: write`, and `id-token: write`. Recommend gating the trigger on `author_association` in `(OWNER, MEMBER, COLLABORATOR)` before granting write scopes.
- **Merge enforcement:** CHANGE_POLICY.md requires explicit review before merge to `main`, but no CODEOWNERS file or required-reviewer branch ruleset currently enforces this technically — it relies on process discipline alone.
- **Test coverage:** TESTING.md defines 12 minimum regression cases, but `tests/fixtures/` currently contains only the rules `README.md` — no fixtures or test files implementing those cases exist yet, so the "tests pass" acceptance criterion has nothing to run against.
