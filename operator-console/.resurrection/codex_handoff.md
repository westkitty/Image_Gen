# Codex Handoff: operator-console

Read this handoff and project_report.md first.

## Project Identity
- Name: operator-console
- Path: /Users/andrew/Image_Gen/operator-console
- Purpose: A web or Node.js project named operator console.

## Current Git State
- Repo root: /Users/andrew/Image_Gen | Branch: main | Status: dirty | Remote: git@github.com:westkitty/Image_Gen.git
- Latest commit: 865a7c517069270454944cc738ffce2ef4dd1ea8 fix: make DexDiffusion the default app entrypoint

## Detected Project Type
- Type: node_web_app
- Confidence: 0.71
- Evidence:
  - Found package.json

## Likely Commands
- [run/dev] npm run check
- [run/dev] npm run start
- [test] npm run test

## Fragile Files
- package-lock.json
- package.json
- README.md

## Duplicate Or Stale Candidates
- None detected.

## Secret-Risk Warning Summary
- server.js:1078 (openai_sk_prefix)

## Top 5 Recommended Next Actions
1. Inspect the current uncommitted Git changes before making new edits.
2. Review secret-risk findings and move sensitive values out of tracked files.
3. Back up or review fragile configuration files before any risky changes.
4. Validate the project with the hinted test command: npm run test
5. Validate the project with the hinted run/dev command: npm run check

## Strict Codex Instruction Block

Read this handoff and project_report.md first.
Make one bounded change only.
Do not rewrite the project.
Do not delete or reorganize files.
Inspect existing files before editing.
Run the smallest relevant validation command available.
If validation cannot be run, explain why.
Report changed files, commands run, test results, and remaining risks.
