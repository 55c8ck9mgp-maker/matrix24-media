# Claude GitHub Integration Setup

This setup connects Claude to MATRIX 24 as a staging engineer and independent reviewer. It does not grant Claude production deployment authority.

## 1. Install the official Claude GitHub App

Install the official Claude GitHub App and grant it access only to:

`55c8ck9mgp-maker/matrix24-media`

Repository admin access is required for installation.

## 2. Configure Anthropic authentication

Preferred initial method: direct Anthropic API key.

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
Name: ANTHROPIC_API_KEY
Value: <paste directly in GitHub; never place it in issues, PRs, code, or chat>
```

Alternative supported by Anthropic: `CLAUDE_CODE_OAUTH_TOKEN`.

Do not create both unless there is a specific reason.

## 3. Protect main

Where available, configure a branch protection/ruleset for `main`:

- require pull requests before merging,
- prevent direct pushes where practical,
- do not allow Claude to bypass protection.

The purpose is to make Claude's `claude/*` branch boundary enforceable rather than advisory.

## 4. Review PR #1

Review the draft PR:

`Phase 2: Claude staging collaboration framework`

Confirm that it contains only collaboration infrastructure, documentation, workflow configuration, and isolated test-fixture scaffolding.

It must not modify:
- production `queue/`,
- Auto Publisher,
- production Cloudflare deployment,
- social publishing state.

## 5. Merge only after steps 1-3

The Claude workflow is stored in:

`.github/workflows/claude-review.yml`

Issue/comment triggers use `@claude`.

Claude-created branches use the `claude/` prefix.

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
