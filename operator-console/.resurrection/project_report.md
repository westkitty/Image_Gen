# Project Resurrection Report: operator-console

## Identity
- Name: operator-console
- Path: /Users/andrew/Image_Gen/operator-console
- Project type: node_web_app
- Confidence: 0.71
- Inferred purpose: A web or Node.js project named operator console.
- Evidence:
  - Found package.json

## Git State
- Summary: Repo root: /Users/andrew/Image_Gen | Branch: main | Status: dirty | Remote: git@github.com:westkitty/Image_Gen.git
- Latest commit: 865a7c517069270454944cc738ffce2ef4dd1ea8 fix: make DexDiffusion the default app entrypoint
- Tracked modified count: 0
- Untracked count: 2
- Staged count: 0

## Commands Detected
- [run/dev] npm run check (package.json:scripts.check)
- [run/dev] npm run start (package.json:scripts.start)
- [test] npm run test (package.json:scripts.test)

## Fragile Files
- package-lock.json
- package.json
- README.md

## Duplicate Or Stale Candidates
- None detected.

## Secret-Risk Findings
- server.js:1078 (openai_sk_prefix)

## Recommended Next Actions
1. Inspect the current uncommitted Git changes before making new edits.
2. Review secret-risk findings and move sensitive values out of tracked files.
3. Back up or review fragile configuration files before any risky changes.
4. Validate the project with the hinted test command: npm run test
5. Validate the project with the hinted run/dev command: npm run check

## Scan Metadata
- Timestamp: 2026-06-27T18:16:13+00:00
- Scanner version: 1.0.0
